import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "../state/app";
import { bookAbi } from "../abi/book";
import { erc20Abi } from "../abi/erc20";
import {
  alignTick,
  amountToInput,
  fmtAmount,
  fmtPrice,
  parseAmount,
  priceToTick,
  tickToPrice,
} from "../lib/format";
import { baseDecimals, quoteDecimals } from "../lib/config";

type Side = "bid" | "ask";

const MAX_UINT = 2n ** 256n - 1n;
const E18 = 10n ** 18n;
const E15 = 10n ** 15n;

interface Plan {
  lower: number;
  upper: number;
  n: number;
  liquidity: bigint; // L0 per level
  slope: bigint;
  cost: bigint; // token0 for asks, token1 for bids
  error: string | null;
}

/**
 * U7 — ladder shape presets. Each preset sets the side, a price band around
 * the mid (as a +/- offset in price units) and the shape (flat or front-
 * loaded). Sizing is left to the trader. Offsets are in absolute price so
 * they read naturally on the $0.001-tick book.
 */
interface LadderPreset {
  id: string;
  label: string;
  desc: string;
  side: Side;
  /** inner / outer offset from mid, in price units */
  inner: number;
  outer: number;
  frontLoaded: boolean;
}

const LADDER_PRESETS: LadderPreset[] = [
  { id: "tight-ask", label: "Tight ask", desc: "5 levels just above mid", side: "ask", inner: 0.01, outer: 0.06, frontLoaded: false },
  { id: "tight-bid", label: "Tight bid", desc: "5 levels just below mid", side: "bid", inner: 0.01, outer: 0.06, frontLoaded: false },
  { id: "wide-ask", label: "Wide ask", desc: "deep 20-level ask wall", side: "ask", inner: 0.01, outer: 0.21, frontLoaded: false },
  { id: "wide-bid", label: "Wide bid", desc: "deep 20-level bid wall", side: "bid", inner: 0.01, outer: 0.21, frontLoaded: false },
  { id: "front-ask", label: "Front-loaded ask", desc: "size concentrated at the touch", side: "ask", inner: 0.01, outer: 0.11, frontLoaded: true },
  { id: "scalp-ask", label: "Scalp ask", desc: "1-2 levels at the touch", side: "ask", inner: 0.005, outer: 0.02, frontLoaded: false },
  { id: "scalp-bid", label: "Scalp bid", desc: "1-2 levels at the touch", side: "bid", inner: 0.005, outer: 0.02, frontLoaded: false },
];

export function MakePanel() {
  const { cfg, client, wallet, account, summary, balances, sendTx, busy, refresh, setPreview, market, onCommand } = useApp();
  const baseDec = baseDecimals(cfg);
  const quoteDec = quoteDecimals(cfg);
  const [side, setSide] = useState<Side>("ask");
  const [fromStr, setFromStr] = useState("");
  const [toStr, setToStr] = useState("");
  const [sizeStr, setSizeStr] = useState("");
  const [totalStr, setTotalStr] = useState("");
  const [editingTotal, setEditingTotal] = useState(false);
  const [frontLoaded, setFrontLoaded] = useState(false);
  const [activePreset, setActivePreset] = useState<string | null>(null);
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

  const switchSide = (s: Side) => {
    setSide(s);
    setFromStr("");
    setToStr("");
    setFrontLoaded(false);
    setActivePreset(null);
  };

  // U7 — apply a ladder shape preset: set side, band (relative to mid) + shape.
  const applyPreset = useCallback(
    (p: LadderPreset) => {
      setSide(p.side);
      setFrontLoaded(p.frontLoaded);
      setActivePreset(p.id);
      if (mid !== null) {
        if (p.side === "ask") {
          setFromStr((mid + p.inner).toFixed(3));
          setToStr((mid + p.outer).toFixed(3));
        } else {
          setFromStr((mid - p.outer).toFixed(3));
          setToStr((mid - p.inner).toFixed(3));
        }
      }
    },
    [mid],
  );

  const sizePerLevel = parseAmount(sizeStr, baseDec);

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

    if (sizePerLevel === null || sizePerLevel === 0n) {
      return { lower, upper, n, liquidity: 0n, slope: 0n, cost: 0n, error };
    }

    const nB = BigInt(n);
    let liquidity = sizePerLevel;
    let slope = 0n;
    if (side === "ask" && frontLoaded && n > 1) {
      liquidity = (sizePerLevel * 3n) / 2n;
      slope = -(sizePerLevel / BigInt(n - 1));
      const lastLevel = liquidity + slope * (nB - 1n);
      if (lastLevel < 1n) {
        slope = 0n;
        liquidity = sizePerLevel;
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
        return { lower, upper, n, liquidity, slope, cost: 0n, error: "Range below zero price." };
      }
      cost = (liquidity * rateSum + E18 - 1n) / E18;
    }
    return { lower, upper, n, liquidity, slope, cost, error };
  }, [cur, fromStr, toStr, sizeStr, side, spacing, frontLoaded, sizePerLevel?.toString()]); // eslint-disable-line react-hooks/exhaustive-deps

  // size/level <-> total: cost is linear in size per level on every path
  // (flat, front-loaded, bid), so either field derives the other
  const totalForSize = plan && plan.cost > 0n ? plan.cost : null;
  const sizeFromTotal = (tStr: string): string | null => {
    if (plan === null || plan.n <= 0) return null;
    const t = parseAmount(tStr, side === "ask" ? baseDec : quoteDec);
    if (t === null) return null;
    const nB = BigInt(plan.n);
    let size: bigint;
    if (side === "ask") {
      size = t / nB; // shaped cost == size*n too (1.5..0.5 averages to 1)
    } else {
      const tickSum = nB * BigInt(plan.lower) + (BigInt(spacing) * nB * (nB - 1n)) / 2n;
      const rateSum = nB * E18 + tickSum * E15;
      if (rateSum <= 0n) return null;
      size = (t * E18) / rateSum;
    }
    return amountToInput(size, baseDec);
  };

  // keep the non-edited field in sync
  useEffect(() => {
    if (editingTotal) return;
    setTotalStr(totalForSize !== null ? amountToInput(totalForSize, side === "ask" ? baseDec : quoteDec) : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [totalForSize?.toString(), editingTotal, side]);

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
  const paySymbol = side === "ask" ? market.baseSymbol : market.quoteSymbol;
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
    plan !== null && plan.error === null && plan.cost > 0n && sizePerLevel !== null;
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
      setSizeStr("");
      refresh();
    }
  };

  // U2 — keep the latest submit handler addressable from the command effect
  // without re-subscribing on every keystroke.
  const submitRef = useRef(onSubmit);
  submitRef.current = onSubmit;
  const readyRef = useRef(ready);
  readyRef.current = ready;

  useEffect(
    () =>
      onCommand((cmd) => {
        if (cmd.type === "set-side") {
          switchSide(cmd.side === "buy" ? "bid" : "ask");
        } else if (cmd.type === "toggle-side") {
          switchSide(side === "ask" ? "bid" : "ask");
        } else if (cmd.type === "submit") {
          if (readyRef.current) void submitRef.current();
        } else if (cmd.type === "quote-at-price") {
          // U4 — click-to-quote from the order book: seed a one-band ladder at
          // the clicked price on the matching side.
          setSide(cmd.side);
          setActivePreset(null);
          setFrontLoaded(false);
          const p = cmd.price;
          if (cmd.side === "ask") {
            setFromStr(p.toFixed(3));
            setToStr((p + 0.05).toFixed(3));
          } else {
            setFromStr((p - 0.05).toFixed(3));
            setToStr(p.toFixed(3));
          }
        }
      }),
    [onCommand, side],
  );

  return (
    <div className="trade-panel">
      <div className="preset-row">
        <span className="preset-title dim">Templates</span>
        <div className="preset-chips">
          {LADDER_PRESETS.map((p) => (
            <button
              key={p.id}
              className={`preset-chip ${activePreset === p.id ? "preset-chip-on" : ""} ${p.side === "ask" ? "preset-ask" : "preset-bid"}`}
              onClick={() => applyPreset(p)}
              title={p.desc}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>
      <div className="seg">
        <button className={`seg-btn ${side === "bid" ? "seg-buy" : ""}`} onClick={() => switchSide("bid")}>
          {market.makerBidLabel} <span className="seg-note">{market.bidNote}</span>
        </button>
        <button className={`seg-btn ${side === "ask" ? "seg-sell" : ""}`} onClick={() => switchSide("ask")}>
          {market.makerAskLabel} <span className="seg-note">{market.askNote}</span>
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
          <span className="field-label">Size per level <span className="dim">({market.baseSymbol})</span></span>
          <input
            className="input num"
            inputMode="decimal"
            placeholder="0.0"
            value={sizeStr}
            onChange={(e) => setSizeStr(e.target.value)}
            onKeyDown={onArrow(sizeStr, setSizeStr, 0.01, 4)}
          />
        </label>
        <label className="field">
          <span className="field-label">
            Total <span className="dim">({paySymbol})</span>
            <span className="field-bal num">bal {fmtAmount(payBalance, side === "ask" ? 4 : 2, side === "ask" ? baseDec : quoteDec)}</span>
          </span>
          <input
            className="input num"
            inputMode="decimal"
            placeholder="0.0"
            value={totalStr}
            onFocus={() => setEditingTotal(true)}
            onBlur={() => setEditingTotal(false)}
            onChange={(e) => {
              setTotalStr(e.target.value);
              const s = sizeFromTotal(e.target.value);
              if (s !== null) setSizeStr(s);
            }}
            onKeyDown={onArrow(totalStr, (v) => {
              setTotalStr(v);
              const s = sizeFromTotal(v);
              if (s !== null) setSizeStr(s);
            }, side === "ask" ? 0.01 : 10, side === "ask" ? 4 : 2)}
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
          <span className="dim">Total {side === "ask" ? market.baseSymbol : market.quoteSymbol} required</span>
          <span>{plan && plan.cost > 0n ? fmtAmount(plan.cost, side === "ask" ? 4 : 2, side === "ask" ? baseDec : quoteDec) : "—"}</span>
        </div>
        {side === "bid" && plan && plan.cost > 0n && (
          <div className="qrow">
            <span className="dim">Total {market.baseSymbol} bid for</span>
            <span>{fmtAmount(plan.liquidity * BigInt(plan.n), 4, baseDec)}</span>
          </div>
        )}
      </div>

      {plan?.error && <div className="note warn">{plan.error}</div>}
      {side === "ask" && mid !== null && (
        <div className="note dim-note">
          {market.makerAskLabel}s rest above the current price ({fmtPrice(mid, 3)}); the range is auto-bumped if
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
              ? market.makerBidButton
              : market.makerAskButton}
        </button>
      )}
    </div>
  );
}
