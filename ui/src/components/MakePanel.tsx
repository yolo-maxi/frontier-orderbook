import { useCallback, useEffect, useMemo, useState } from "react";
import { useApp } from "../state/app";
import { bookAbi } from "../abi/book";
import { erc20Abi } from "../abi/erc20";
import {
  alignTick,
  fmtAmount,
  fmtPrice,
  parseAmount,
  priceToTick,
  tickToPrice,
} from "../lib/format";

type Side = "bid" | "ask";

const MAX_UINT = 2n ** 256n - 1n;
const E18 = 10n ** 18n;
const E15 = 10n ** 15n;

interface Plan {
  lower: number;
  upper: number;
  n: number;
  size: bigint; // avg token0 quantity per level (= maxQty / n)
  liquidity: bigint; // L0 deposited at the first level
  slope: bigint;
  cost: bigint; // token0 for asks, token1 for bids
  error: string | null;
}

export function MakePanel() {
  const { cfg, client, wallet, account, summary, balances, sendTx, busy, refresh, setPreview, makeRange } = useApp();
  const [side, setSide] = useState<Side>("ask");
  const [fromStr, setFromStr] = useState("");
  const [toStr, setToStr] = useState("");
  // PRIMARY input: the max quantity (total token0 across the whole ladder).
  // Per-level size is DERIVED from this and the level count, so widening or
  // dragging the range keeps the total you commit fixed.
  const [qtyStr, setQtyStr] = useState("");
  const [frontLoaded, setFrontLoaded] = useState(false);
  const [allowance, setAllowance] = useState<bigint | null>(null);

  const spacing = summary?.tickSpacing ?? 1;
  const cur = summary?.currentTick ?? null;
  const mid = cur !== null ? tickToPrice(cur) : null;

  // Prefill sensible default ranges when empty / side changes
  useEffect(() => {
    if (mid === null) return;
    if (fromStr === "" && toStr === "") {
      // ticks are $0.001 thin — keep default ladders narrow (50 levels)
      if (side === "ask") {
        setFromStr((mid + 0.01).toFixed(3));
        setToStr((mid + 0.06).toFixed(3));
      } else {
        setFromStr((mid - 0.06).toFixed(3));
        setToStr((mid - 0.01).toFixed(3));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [side, mid === null]);

  // Dragging the gold band edges on the chart rewrites the range here.
  useEffect(() => {
    if (!makeRange) return;
    setFromStr(tickToPrice(makeRange.lowerTick).toFixed(3));
    setToStr(tickToPrice(makeRange.upperTick).toFixed(3));
  }, [makeRange]);

  const switchSide = (s: Side) => {
    setSide(s);
    setFromStr("");
    setToStr("");
    setFrontLoaded(false);
  };

  const maxQty = parseAmount(qtyStr);

  // arrow keys nudge any numeric field; shift = 10x increment
  const onArrow =
    (value: string, set: (s: string) => void, inc: number, dp: number) =>
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
      e.preventDefault();
      const x = Number(value || "0");
      if (!Number.isFinite(x)) return;
      const d = (e.key === "ArrowUp" ? 1 : -1) * inc * (e.shiftKey ? 10 : 1);
      set(Math.max(0, x + d).toFixed(dp));
    };

  const plan: Plan | null = useMemo(() => {
    if (cur === null) return null;
    const fromP = Number(fromStr);
    const toP = Number(toStr);
    if (!Number.isFinite(fromP) || !Number.isFinite(toP) || fromStr === "" || toStr === "") {
      return null;
    }
    const loP = Math.min(fromP, toP);
    const hiP = Math.max(fromP, toP);
    let lower = alignTick(priceToTick(loP), spacing, false);
    let upper = alignTick(priceToTick(hiP), spacing, true);

    let error: string | null = null;
    if (side === "ask") {
      const minLower = alignTick(cur + 1, spacing, true);
      if (lower <= cur) lower = minLower;
      if (upper <= lower) upper = lower + spacing;
    } else {
      const maxUpper = alignTick(cur, spacing, false);
      if (upper > cur) upper = maxUpper;
      if (lower >= upper) lower = upper - spacing;
      if (upper > cur) error = "Bid range must sit at or below the current price.";
    }
    const n = Math.round((upper - lower) / spacing);
    if (n <= 0) error = error ?? "Range is empty after tick alignment.";

    if (maxQty === null || maxQty === 0n || n <= 0) {
      return { lower, upper, n, size: 0n, liquidity: 0n, slope: 0n, cost: 0n, error };
    }

    const nB = BigInt(n);
    // DERIVE per-level size from the fixed max quantity. The total committed
    // is maxQty regardless of how many levels the range spans.
    const size = maxQty / nB;
    if (size === 0n) {
      return { lower, upper, n, size: 0n, liquidity: 0n, slope: 0n, cost: 0n, error: "Quantity too small for this many levels." };
    }

    let liquidity = size;
    let slope = 0n;
    if (side === "ask" && frontLoaded && n > 1) {
      // 1.5× at the touch tapering to 0.5× — averages back to `size`, so the
      // total still equals maxQty.
      liquidity = (size * 3n) / 2n;
      slope = -(size / BigInt(n - 1));
      const lastLevel = liquidity + slope * (nB - 1n);
      if (lastLevel < 1n) {
        slope = 0n;
        liquidity = size;
      }
    }

    let cost: bigint;
    if (side === "ask") {
      cost = liquidity * nB + (slope * nB * (nB - 1n)) / 2n;
    } else {
      // token1 value of uniform span: ceil(size * Σ rate(t) / 1e18)
      const tickSum = nB * BigInt(lower) + (BigInt(spacing) * nB * (nB - 1n)) / 2n;
      const rateSum = nB * E18 + tickSum * E15;
      if (rateSum <= 0n) {
        return { lower, upper, n, size, liquidity, slope, cost: 0n, error: "Range below zero price." };
      }
      cost = (liquidity * rateSum + E18 - 1n) / E18;
    }
    return { lower, upper, n, size, liquidity, slope, cost, error };
  }, [cur, fromStr, toStr, qtyStr, side, spacing, frontLoaded, maxQty?.toString()]); // eslint-disable-line react-hooks/exhaustive-deps

  // publish the configured ladder to the chart as a live preview
  useEffect(() => {
    if (plan && plan.error === null && plan.liquidity > 0n && plan.upper > plan.lower) {
      setPreview({
        kind: "make",
        side: side === "ask" ? "ask" : "bid",
        lowerTick: plan.lower,
        upperTick: plan.upper,
        sizePerLevel: plan.liquidity,
        slope: plan.slope,
      });
    } else {
      setPreview(null);
    }
  }, [plan, side, setPreview]);
  useEffect(() => () => setPreview(null), [setPreview]);

  const payToken = side === "ask" ? cfg.contracts.weth : cfg.contracts.usdc;
  const paySymbol = side === "ask" ? "WETH" : "USDC";
  const payBalance = side === "ask" ? balances.weth : balances.usdc;

  const loadAllowance = useCallback(async () => {
    try {
      const a = await client.readContract({
        address: payToken,
        abi: erc20Abi,
        functionName: "allowance",
        args: [account.address, cfg.contracts.book],
      });
      setAllowance(a);
    } catch {
      setAllowance(null);
    }
  }, [client, payToken, account, cfg]);

  useEffect(() => {
    setAllowance(null);
    loadAllowance();
  }, [loadAllowance, busy]);

  const ready =
    plan !== null && plan.error === null && plan.cost > 0n && maxQty !== null;
  const insufficient = ready && plan!.cost > payBalance;
  const needsApproval = ready && allowance !== null && allowance < plan!.cost;

  const onApprove = () =>
    sendTx(`Approve ${paySymbol} for book`, () =>
      wallet.writeContract({
        address: payToken,
        abi: erc20Abi,
        functionName: "approve",
        args: [cfg.contracts.book, MAX_UINT],
      }),
    ).then(() => loadAllowance());

  const onSubmit = async () => {
    if (!ready) return;
    const p = plan!;
    const label =
      side === "ask"
        ? `Place ask ladder ${fmtPrice(tickToPrice(p.lower), 2)}–${fmtPrice(tickToPrice(p.upper), 2)}`
        : `Place bid ladder ${fmtPrice(tickToPrice(p.lower), 2)}–${fmtPrice(tickToPrice(p.upper), 2)}`;
    const ok = await sendTx(label, () => {
      if (side === "bid") {
        return wallet.writeContract({
          address: cfg.contracts.book,
          abi: bookAbi,
          functionName: "depositBid",
          args: [p.lower, p.upper, p.liquidity],
        });
      }
      if (p.slope !== 0n) {
        return wallet.writeContract({
          address: cfg.contracts.book,
          abi: bookAbi,
          functionName: "depositShaped",
          args: [p.lower, p.upper, p.liquidity, p.slope],
        });
      }
      return wallet.writeContract({
        address: cfg.contracts.book,
        abi: bookAbi,
        functionName: "deposit",
        args: [p.lower, p.upper, p.liquidity],
      });
    });
    if (ok) {
      setQtyStr("");
      refresh();
    }
  };

  return (
    <div className="trade-panel">
      <div className="seg">
        <button className={`seg-btn ${side === "bid" ? "seg-buy" : ""}`} onClick={() => switchSide("bid")}>
          Bid <span className="seg-note">buy WETH</span>
        </button>
        <button className={`seg-btn ${side === "ask" ? "seg-sell" : ""}`} onClick={() => switchSide("ask")}>
          Ask <span className="seg-note">sell WETH</span>
        </button>
      </div>

      <div className="field-row">
        <label className="field">
          <span className="field-label">From price</span>
          <input
            className="input num"
            inputMode="decimal"
            placeholder="0.00"
            value={fromStr}
            onChange={(e) => setFromStr(e.target.value)}
            onKeyDown={onArrow(fromStr, setFromStr, 0.01, 3)}
          />
        </label>
        <label className="field">
          <span className="field-label">To price</span>
          <input
            className="input num"
            inputMode="decimal"
            placeholder="0.00"
            value={toStr}
            onChange={(e) => setToStr(e.target.value)}
            onKeyDown={onArrow(toStr, setToStr, 0.01, 3)}
          />
        </label>
      </div>

      <div className="field-row">
        <label className="field">
          <span className="field-label">
            Max quantity <span className="dim">(WETH)</span>
            <span className="field-bal num">
              {paySymbol} bal {fmtAmount(payBalance, side === "ask" ? 4 : 2)}
            </span>
          </span>
          <input
            className="input num"
            inputMode="decimal"
            placeholder="0.0"
            value={qtyStr}
            onChange={(e) => setQtyStr(e.target.value)}
            onKeyDown={onArrow(qtyStr, setQtyStr, 0.01, 4)}
          />
        </label>
        <label className="field">
          <span className="field-label">
            Size / level <span className="dim">(derived)</span>
          </span>
          <input
            className="input num input-derived"
            inputMode="decimal"
            placeholder="—"
            readOnly
            tabIndex={-1}
            value={plan && plan.size > 0n ? fmtAmount(plan.size, 5) : ""}
          />
        </label>
      </div>

      {side === "ask" && (
        <label className="check">
          <input
            type="checkbox"
            checked={frontLoaded}
            onChange={(e) => setFrontLoaded(e.target.checked)}
          />
          <span>
            Front-loaded ladder <span className="dim">(linear slope: 1.5× at the first level tapering to 0.5×)</span>
          </span>
        </label>
      )}

      <div className="quote-box num">
        <div className="qrow">
          <span className="dim">Aligned range</span>
          <span>
            {plan ? (
              <>
                {fmtPrice(tickToPrice(plan.lower), 3)} <span className="dim">→</span>{" "}
                {fmtPrice(tickToPrice(plan.upper), 3)}
              </>
            ) : (
              "—"
            )}
          </span>
        </div>
        <div className="qrow">
          <span className="dim">Ticks</span>
          <span>
            {plan ? `${plan.lower.toLocaleString()} → ${plan.upper.toLocaleString()}` : "—"}
          </span>
        </div>
        <div className="qrow">
          <span className="dim">Levels</span>
          <span>{plan ? plan.n.toLocaleString() : "—"}</span>
        </div>
        <div className="qrow">
          <span className="dim">{side === "ask" ? "Total WETH committed" : "Total USDC required"}</span>
          <span>{plan && plan.cost > 0n ? fmtAmount(plan.cost, side === "ask" ? 4 : 2) : "—"}</span>
        </div>
        {side === "bid" && plan && plan.cost > 0n && (
          <div className="qrow">
            <span className="dim">Total WETH bid for</span>
            <span>{fmtAmount(plan.liquidity * BigInt(plan.n), 4)}</span>
          </div>
        )}
      </div>

      {plan?.error && <div className="note warn">{plan.error}</div>}
      {side === "ask" && mid !== null && (
        <div className="note dim-note">
          Asks rest above the current price ({fmtPrice(mid, 3)}); the range is auto-bumped if
          it overlaps.
        </div>
      )}

      {needsApproval && !insufficient ? (
        <button className="btn btn-wide btn-accent" disabled={busy !== null} onClick={onApprove}>
          Approve {paySymbol}
        </button>
      ) : (
        <button
          className={`btn btn-wide ${side === "bid" ? "btn-buy" : "btn-sell"}`}
          disabled={busy !== null || !ready || insufficient}
          onClick={onSubmit}
        >
          {insufficient
            ? `Insufficient ${paySymbol}`
            : side === "bid"
              ? "Place Bid Ladder"
              : "Place Ask Ladder"}
        </button>
      )}
    </div>
  );
}
