import { useCallback, useEffect, useMemo, useState } from "react";
import { useApp } from "../state/app";
import { lensAbi } from "../abi/lens";
import { erc20Abi } from "../abi/erc20";
import { routerAbi } from "../abi/router";
import { bookAbi } from "../abi/book";
import { alignTick, fmtAmount, fmtPrice, parseAmount, priceToTick, tickToPrice } from "../lib/format";

type Side = "buy" | "sell";

interface Quote {
  out: bigint;
  spent: bigint;
  endTick: number;
}

const SLIPPAGE_OPTS = [0.1, 0.5, 1.0];
const MAX_UINT = 2n ** 256n - 1n;
const QUOTE_MAX_LEVELS = 500n;

export function TradePanel() {
  const { cfg, client, wallet, account, summary, balances, sendTx, busy, refresh, setPreview, market } = useApp();
  const [side, setSide] = useState<Side>("buy");
  const [mode, setMode] = useState<"market" | "limit">("market");
  const [amountStr, setAmountStr] = useState("");
  const [limitPriceStr, setLimitPriceStr] = useState("");
  const [bookAllowance, setBookAllowance] = useState<bigint | null>(null);
  const [slippage, setSlippage] = useState(0.5);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteErr, setQuoteErr] = useState<string | null>(null);
  const [allowance, setAllowance] = useState<bigint | null>(null);

  // project the quoted execution range onto the chart (market mode)
  useEffect(() => {
    if (mode !== "market") return;
    if (quote && quote.out > 0n) {
      setPreview({ kind: "trade", side: side === "buy" ? "ask" : "bid", endTick: quote.endTick });
    } else {
      setPreview(null);
    }
  }, [mode, quote, side, setPreview]);
  useEffect(() => () => setPreview(null), [setPreview]);

  const amountIn = parseAmount(amountStr);
  const tokenIn = side === "buy" ? cfg.contracts.usdc : cfg.contracts.weth;
  const tokenOut = side === "buy" ? cfg.contracts.weth : cfg.contracts.usdc;
  const balanceIn = side === "buy" ? balances.usdc : balances.weth;

  // ---- live quote (debounced + refreshed)
  useEffect(() => {
    let stop = false;
    if (mode !== "market" || amountIn === null || amountIn === 0n) {
      setQuote(null);
      setQuoteErr(null);
      return;
    }
    const run = async () => {
      try {
        if (side === "buy") {
          const [out, spent, endTick] = await client.readContract({
            address: cfg.contracts.lens,
            abi: lensAbi,
            functionName: "quoteBuy",
            args: [cfg.contracts.book, amountIn],
          });
          if (!stop) {
            setQuote({ out, spent, endTick: Number(endTick) });
            setQuoteErr(null);
          }
        } else {
          const [out, spent, endTick] = await client.readContract({
            address: cfg.contracts.lens,
            abi: lensAbi,
            functionName: "quoteSell",
            args: [cfg.contracts.book, amountIn, QUOTE_MAX_LEVELS],
          });
          if (!stop) {
            setQuote({ out, spent, endTick: Number(endTick) });
            setQuoteErr(null);
          }
        }
      } catch (e) {
        if (!stop) {
          setQuote(null);
          setQuoteErr(e instanceof Error ? e.message.split("\n")[0] : "quote failed");
        }
      }
    };
    const t = setTimeout(run, 250);
    const iv = setInterval(run, 2000);
    return () => {
      stop = true;
      clearTimeout(t);
      clearInterval(iv);
    };
  }, [client, cfg, side, mode, amountIn?.toString()]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- allowance for router
  const loadAllowance = useCallback(async () => {
    try {
      const a = await client.readContract({
        address: tokenIn,
        abi: erc20Abi,
        functionName: "allowance",
        args: [account.address, cfg.contracts.router],
      });
      setAllowance(a);
    } catch {
      setAllowance(null);
    }
  }, [client, tokenIn, account, cfg]);

  useEffect(() => {
    setAllowance(null);
    loadAllowance();
  }, [loadAllowance, busy]);

  const mid = summary ? tickToPrice(summary.currentTick) : null;

  const derived = useMemo(() => {
    if (!quote || amountIn === null || amountIn === 0n || quote.out === 0n) return null;
    const inF = Number(quote.spent) / 1e18;
    const outF = Number(quote.out) / 1e18;
    const avgPrice = side === "buy" ? inF / outF : outF / inF;
    const impact =
      mid !== null && mid > 0
        ? side === "buy"
          ? (avgPrice / mid - 1) * 100
          : (1 - avgPrice / mid) * 100
        : null;
    const minOut = (quote.out * BigInt(Math.round((100 - slippage) * 1000))) / 100_000n;
    const partial = quote.spent < amountIn;
    return { avgPrice, impact, minOut, partial, endPrice: tickToPrice(quote.endTick) };
  }, [quote, amountIn, side, mid, slippage]);

  // ---- LIMIT orders: native to the book — a one-tick ladder IS a resting
  // limit order. Post-only: a price that crosses the book is rejected with
  // a hint to use Market (or a better price).
  const spacing = summary?.tickSpacing ?? 1;
  const curTick = summary?.currentTick ?? null;
  const amountWeth = parseAmount(amountStr); // limit amounts are in WETH both sides
  const limitPlan = useMemo(() => {
    if (mode !== "limit" || curTick === null) return null;
    const p = Number(limitPriceStr);
    if (!Number.isFinite(p) || limitPriceStr === "" || p <= 0) return null;
    if (amountWeth === null || amountWeth === 0n) return null;
    let tick = alignTick(priceToTick(p), spacing, false);
    let error: string | null = null;
    if (side === "buy") {
      // bids rest at or below the current price
      if (tick + spacing > curTick) error = "Crosses the book — lower the price or use Market.";
      const rate = BigInt(1e18) + BigInt(tick) * BigInt(1e15);
      const cost = (amountWeth * rate + BigInt(1e18) - 1n) / BigInt(1e18);
      return { tick, cost, error, fn: "depositBid" as const };
    }
    // asks rest above the current price
    if (tick <= curTick) error = "Crosses the book — raise the price or use Market.";
    return { tick, cost: amountWeth, error, fn: "deposit" as const };
  }, [mode, curTick, limitPriceStr, amountWeth?.toString(), side, spacing]); // eslint-disable-line react-hooks/exhaustive-deps

  // limit orders pay the BOOK directly (market orders pay the router)
  const loadBookAllowance = useCallback(async () => {
    try {
      const a = await client.readContract({
        address: side === "buy" ? cfg.contracts.usdc : cfg.contracts.weth,
        abi: erc20Abi,
        functionName: "allowance",
        args: [account.address, cfg.contracts.book],
      });
      setBookAllowance(a);
    } catch {
      setBookAllowance(null);
    }
  }, [client, side, account, cfg]);
  useEffect(() => {
    if (mode === "limit") loadBookAllowance();
  }, [mode, loadBookAllowance, busy]);

  // project the resting order onto the chart while configuring
  useEffect(() => {
    if (mode === "limit" && limitPlan && limitPlan.error === null && amountWeth !== null && amountWeth > 0n) {
      setPreview({
        kind: "make",
        side: side === "buy" ? "bid" : "ask",
        lowerTick: limitPlan.tick,
        upperTick: limitPlan.tick + spacing,
        sizePerLevel: amountWeth,
        slope: 0n,
      });
    } else if (mode === "limit") {
      setPreview(null);
    }
  }, [mode, limitPlan, amountWeth?.toString(), side, spacing, setPreview]); // eslint-disable-line react-hooks/exhaustive-deps

  const onPlaceLimit = async () => {
    if (!limitPlan || limitPlan.error !== null || amountWeth === null) return;
    const label = `Limit ${side} ${fmtAmount(amountWeth, 4)} ${market.baseSymbol} @ ${fmtPrice(tickToPrice(limitPlan.tick), 3)}`;
    const ok = await sendTx(label, () =>
      wallet.writeContract({
        address: cfg.contracts.book,
        abi: bookAbi,
        functionName: limitPlan.fn,
        args: [limitPlan.tick, limitPlan.tick + spacing, amountWeth],
      }),
    );
    if (ok) {
      setAmountStr("");
      refresh();
    }
  };

  const limitPayToken = side === "buy" ? cfg.contracts.usdc : cfg.contracts.weth;
  const limitPaySymbol = side === "buy" ? market.quoteSymbol : market.baseSymbol;
  const limitNeedsApproval =
    limitPlan !== null && limitPlan.error === null && bookAllowance !== null && bookAllowance < limitPlan.cost;
  const limitInsufficient =
    limitPlan !== null && limitPlan.cost > (side === "buy" ? balances.usdc : balances.weth);

  const onApproveBook = () =>
    sendTx(`Approve ${limitPaySymbol} for book`, () =>
      wallet.writeContract({
        address: limitPayToken,
        abi: erc20Abi,
        functionName: "approve",
        args: [cfg.contracts.book, MAX_UINT],
      }),
    ).then(() => loadBookAllowance());

  const needsApproval =
    allowance !== null && amountIn !== null && amountIn > 0n && allowance < amountIn;
  const insufficient = amountIn !== null && amountIn > balanceIn;

  const onApprove = () =>
    sendTx(`Approve ${side === "buy" ? market.quoteSymbol : market.baseSymbol}`, () =>
      wallet.writeContract({
        address: tokenIn,
        abi: erc20Abi,
        functionName: "approve",
        args: [cfg.contracts.router, MAX_UINT],
      }),
    ).then(() => loadAllowance());

  const onSwap = async () => {
    if (amountIn === null || derived === null) return;
    // deadline must be CHAIN-relative: the devnet's instamine block time
    // runs ahead of wall clocks, so Date.now()-based deadlines arrive
    // already expired
    const { timestamp } = await client.getBlock({ blockTag: "latest" });
    const deadline = timestamp + 600n;
    const ok = await sendTx(
      side === "buy" ? `Market buy ${market.baseSymbol}` : `Market sell ${market.baseSymbol}`,
      () =>
        wallet.writeContract({
          address: cfg.contracts.router,
          abi: routerAbi,
          functionName: "swapExactTokensForTokens",
          args: [amountIn, derived.minOut, [tokenIn, tokenOut], account.address, deadline],
        }),
    );
    if (ok) {
      setAmountStr("");
      refresh();
    }
  };

  const setPct = (pct: number) => {
    const v = (balanceIn * BigInt(pct)) / 100n;
    setAmountStr((Number(v) / 1e18).toString());
  };

  return (
    <div className="trade-panel">
      <div className="seg">
        <button
          className={`seg-btn ${side === "buy" ? "seg-buy" : ""}`}
          onClick={() => {
            setSide("buy");
            setAmountStr("");
          }}
        >
          {market.buyLabel}
        </button>
        <button
          className={`seg-btn ${side === "sell" ? "seg-sell" : ""}`}
          onClick={() => {
            setSide("sell");
            setAmountStr("");
          }}
        >
          {market.sellLabel}
        </button>
      </div>

      <div className="mode-row">
        <button className={`mode-btn ${mode === "market" ? "mode-on" : ""}`} onClick={() => setMode("market")}>
          Market
        </button>
        <button className={`mode-btn ${mode === "limit" ? "mode-on" : ""}`} onClick={() => setMode("limit")}>
          Limit
        </button>
      </div>

      {mode === "limit" && (
        <label className="field">
          <span className="field-label">
            Limit price <span className="dim">({market.limitPriceUnit})</span>
            {mid !== null && (
              <span className="field-bal num" onClick={() => setLimitPriceStr((side === "buy" ? mid - 0.01 : mid + 0.01).toFixed(3))}>
                mid {fmtPrice(mid, 3)}
              </span>
            )}
          </span>
          <input
            className="input num"
            inputMode="decimal"
            placeholder="0.000"
            value={limitPriceStr}
            onChange={(e) => setLimitPriceStr(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
              e.preventDefault();
              const x = Number(limitPriceStr || (mid ?? 0));
              if (!Number.isFinite(x)) return;
              const d = (e.key === "ArrowUp" ? 1 : -1) * (e.shiftKey ? 0.1 : 0.01);
              setLimitPriceStr(Math.max(0, x + d).toFixed(3));
            }}
          />
        </label>
      )}

      <label className="field">
        <span className="field-label">
          {mode === "limit" ? <>Amount <span className="dim">({market.baseSymbol})</span></> : <>Spend <span className="dim">({side === "buy" ? market.quoteSymbol : market.baseSymbol})</span></>}
          <span className="field-bal num" onClick={() => setPct(100)}>
            bal {fmtAmount(balanceIn, side === "buy" ? 2 : 4)}
          </span>
        </span>
        <input
          className="input num"
          inputMode="decimal"
          placeholder="0.00"
          value={amountStr}
          onChange={(e) => setAmountStr(e.target.value)}
        />
        {mode === "market" && (
          <div className="pct-row">
            {[25, 50, 75, 100].map((p) => (
              <button key={p} className="pct-btn" onClick={() => setPct(p)}>
                {p}%
              </button>
            ))}
          </div>
        )}
      </label>

      {mode === "limit" ? (
        <div className="quote-box num">
          <div className="qrow">
            <span className="dim">Rests at</span>
            <span>{limitPlan ? fmtPrice(tickToPrice(limitPlan.tick), 3) : "—"}</span>
          </div>
          <div className="qrow">
            <span className="dim">You escrow</span>
            <span>
              {limitPlan ? fmtAmount(limitPlan.cost, side === "buy" ? 2 : 4) : "—"}{" "}
              <span className="dim">{limitPaySymbol}</span>
            </span>
          </div>
          <div className="qrow">
            <span className="dim">On fill you get</span>
            <span>
              {limitPlan && amountWeth !== null
                ? side === "buy"
                  ? `${fmtAmount(amountWeth, 4)} ${market.limitBuyReceive}`
                  : `~${fmtAmount((amountWeth * (BigInt(1e18) + BigInt(limitPlan.tick) * BigInt(1e15))) / BigInt(1e18), 2)} ${market.limitSellReceive}`
                : "—"}
            </span>
          </div>
          <div className="qrow">
            <span className="dim">Expiry</span>
            <span>never — claim or cancel anytime</span>
          </div>
        </div>
      ) : (
      <div className="quote-box num">
        <div className="qrow">
          <span className="dim">Receive (est.)</span>
          <span>
            {quote ? fmtAmount(quote.out, side === "buy" ? 5 : 2) : "—"}{" "}
            <span className="dim">{side === "buy" ? market.baseSymbol : market.quoteSymbol}</span>
          </span>
        </div>
        <div className="qrow">
          <span className="dim">Avg. price</span>
          <span>{derived ? fmtPrice(derived.avgPrice, 3) : "—"}</span>
        </div>
        <div className="qrow">
          <span className="dim">Price impact</span>
          <span className={derived?.impact != null && derived.impact > 1 ? "warn" : ""}>
            {derived?.impact != null ? `${derived.impact >= 0 ? "" : "−"}${Math.abs(derived.impact).toFixed(3)}%` : "—"}
          </span>
        </div>
        <div className="qrow">
          <span className="dim">End price</span>
          <span>{derived ? fmtPrice(derived.endPrice, 3) : "—"}</span>
        </div>
        <div className="qrow">
          <span className="dim">Min received</span>
          <span>{derived ? fmtAmount(derived.minOut, side === "buy" ? 5 : 2) : "—"}</span>
        </div>
        <div className="qrow">
          <span className="dim">Slippage</span>
          <span className="slip-opts">
            {SLIPPAGE_OPTS.map((s) => (
              <button
                key={s}
                className={`slip-btn ${slippage === s ? "slip-on" : ""}`}
                onClick={() => setSlippage(s)}
              >
                {s}%
              </button>
            ))}
          </span>
        </div>
      </div>
      )}

      {mode === "limit" && limitPlan?.error && <div className="note warn">{limitPlan.error}</div>}

      {derived?.partial && mode === "market" && (
        <div className="note warn">
          Book depth covers only {fmtAmount(quote!.spent, 2)} of your input — the remainder
          stays in your wallet.
        </div>
      )}
      {quoteErr && amountIn !== null && amountIn > 0n && (
        <div className="note warn">Quote unavailable: {quoteErr}</div>
      )}

      {mode === "limit" ? (
        limitNeedsApproval && !limitInsufficient ? (
          <button className="btn btn-wide btn-accent" disabled={busy !== null} onClick={onApproveBook}>
            Approve {limitPaySymbol}
          </button>
        ) : (
          <button
            className={`btn btn-wide ${side === "buy" ? "btn-buy" : "btn-sell"}`}
            disabled={busy !== null || limitPlan === null || limitPlan.error !== null || limitInsufficient}
            onClick={onPlaceLimit}
          >
            {limitInsufficient
              ? `Insufficient ${limitPaySymbol}`
              : `Place limit ${side} @ ${limitPlan ? fmtPrice(tickToPrice(limitPlan.tick), 3) : "…"}`}
          </button>
        )
      ) : needsApproval ? (
        <button
          className="btn btn-wide btn-accent"
          disabled={busy !== null || insufficient}
          onClick={onApprove}
        >
          Approve {side === "buy" ? market.quoteSymbol : market.baseSymbol}
        </button>
      ) : (
        <button
          className={`btn btn-wide ${side === "buy" ? "btn-buy" : "btn-sell"}`}
          disabled={
            busy !== null ||
            amountIn === null ||
            amountIn === 0n ||
            insufficient ||
            derived === null
          }
          onClick={onSwap}
        >
          {insufficient
            ? "Insufficient balance"
            : side === "buy"
              ? market.buyLabel
              : market.sellLabel}
        </button>
      )}
    </div>
  );
}
