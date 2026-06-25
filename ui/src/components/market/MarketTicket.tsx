import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { useApp } from "../../state/app";
import { lensAbi } from "../../abi/lens";
import { erc20Abi } from "../../abi/erc20";
import { routerAbi } from "../../abi/router";
import { bookAbi } from "../../abi/book";
import {
  baseDecimals,
  quoteDecimals,
  quoteSymbol,
  yesBookAddr,
  noBookAddr,
  yesTokenAddr,
  noTokenAddr,
} from "../../lib/config";
import { alignTick, fmtAmount, fmtUsd, parseAmount, priceToTick, tickToPrice } from "../../lib/format";
import { fmtCents, type Outcome, type OrderPreview, type PredictionBook } from "../../lib/prediction";

type Side = "buy" | "sell";
type Mode = "market" | "limit" | "range";

const MAX_UINT = 2n ** 256n - 1n;
const QUOTE_MAX_LEVELS = 500n;

interface Quote {
  out: bigint;
  spent: bigint;
  endTick: number;
}

export function MarketTicket({
  outcome,
  onOutcome,
  yes,
  no,
  onPreview,
  band,
  setBand,
  draggedRangeSize,
}: {
  outcome: Outcome;
  onOutcome: (o: Outcome) => void;
  yes: PredictionBook;
  no: PredictionBook;
  onPreview?: (p: OrderPreview | null) => void;
  band: { lo: string; hi: string };
  setBand: Dispatch<SetStateAction<{ lo: string; hi: string }>>;
  draggedRangeSize?: { shares: number; nonce: number } | null;
}) {
  const { cfg, client, wallet, addr, balances, sendTx, busy } = useApp();
  const baseDec = baseDecimals(cfg);
  const quoteDec = quoteDecimals(cfg);
  const quoteSym = quoteSymbol(cfg);

  const [side, setSide] = useState<Side>("buy");
  const [mode, setMode] = useState<Mode>("market");
  const [amountStr, setAmountStr] = useState("");
  const [limitCentsStr, setLimitCentsStr] = useState("");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteErr, setQuoteErr] = useState<string | null>(null);
  const [allowance, setAllowance] = useState<bigint | null>(null);
  const [bookAllowance, setBookAllowance] = useState<bigint | null>(null);
  const appliedRangeSizeNonce = useRef<number | null>(null);

  const isYes = outcome === "YES";
  const selected = isYes ? yes : no;
  const book = isYes ? yesBookAddr(cfg) : noBookAddr(cfg);
  const outcomeToken = isYes ? yesTokenAddr(cfg) : noTokenAddr(cfg);
  const collateral = cfg.contracts.usdc;
  const tradable = book !== null && outcomeToken !== null;

  // token going INTO the trade: buy spends sUSDC, sell spends the outcome token.
  // Falls back to collateral when the outcome token is absent (NO not deployed);
  // selling is gated on `tradable` so the fallback never reaches a tx.
  const tokenIn: `0x${string}` = side === "buy" ? collateral : outcomeToken ?? collateral;
  const inDec = side === "buy" ? quoteDec : baseDec;
  const amountIn = parseAmount(amountStr, inDec);
  const shareBalance = isYes ? balances.weth : balances.no;

  useEffect(() => {
    if (!draggedRangeSize || appliedRangeSizeNonce.current === draggedRangeSize.nonce) return;
    appliedRangeSizeNonce.current = draggedRangeSize.nonce;
    if (mode !== "range" || !Number.isFinite(draggedRangeSize.shares)) return;
    setAmountStr(formatNumberInput(draggedRangeSize.shares, Math.min(4, Math.max(0, baseDec))));
  }, [draggedRangeSize, mode, baseDec]);

  // ---- live quote against the SELECTED outcome book
  useEffect(() => {
    let stop = false;
    if (mode !== "market" || !book || amountIn === null || amountIn === 0n) {
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
            args: [book, amountIn],
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
            args: [book, amountIn, QUOTE_MAX_LEVELS],
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
    const t = setTimeout(run, 220);
    const iv = setInterval(run, 2500);
    return () => {
      stop = true;
      clearTimeout(t);
      clearInterval(iv);
    };
  }, [client, cfg, book, side, mode, amountIn?.toString()]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- router allowance (market) and book allowance (limit)
  const loadAllowance = useCallback(async () => {
    try {
      const a = await client.readContract({
        address: tokenIn,
        abi: erc20Abi,
        functionName: "allowance",
        args: [addr, cfg.contracts.router],
      });
      setAllowance(a);
    } catch {
      setAllowance(null);
    }
  }, [client, tokenIn, addr, cfg]);
  const loadBookAllowance = useCallback(async () => {
    if (!book) return;
    try {
      const a = await client.readContract({
        address: tokenIn,
        abi: erc20Abi,
        functionName: "allowance",
        args: [addr, book],
      });
      setBookAllowance(a);
    } catch {
      setBookAllowance(null);
    }
  }, [client, tokenIn, addr, book]);
  useEffect(() => {
    setAllowance(null);
    loadAllowance();
    if (mode !== "market") loadBookAllowance();
  }, [loadAllowance, loadBookAllowance, mode, busy]);

  // ---- derived market quote numbers
  const derived = useMemo(() => {
    if (!quote || amountIn === null || amountIn === 0n || quote.out === 0n) return null;
    const spentF = Number(quote.spent) / 10 ** (side === "buy" ? quoteDec : baseDec);
    const outF = Number(quote.out) / 10 ** (side === "buy" ? baseDec : quoteDec);
    const shares = side === "buy" ? outF : Number(amountIn) / 10 ** baseDec;
    const cost = side === "buy" ? spentF : outF; // sUSDC leg
    const avgPrice = shares > 0 ? cost / shares : 0; // probability
    const toWin = side === "buy" ? shares - cost : 0; // payout if outcome wins
    const partial = quote.spent < amountIn;
    return { shares, cost, avgPrice, toWin, partial, endProb: tickToPrice(quote.endTick) };
  }, [quote, amountIn, side, quoteDec, baseDec]);

  const minOut = useMemo(() => {
    if (!quote || quote.out === 0n) return 0n;
    return (quote.out * 985n) / 1000n; // 1.5% slippage guard
  }, [quote]);

  // ---- limit plan (post a resting order on the selected book)
  const limitCents = Number(limitCentsStr);
  const limitProb = Number.isFinite(limitCents) && limitCents > 0 ? limitCents / 100 : null;
  const amountShares = parseAmount(amountStr, baseDec);
  const limitPlan = useMemo(() => {
    if (mode !== "limit" || !selected || limitProb === null) return null;
    if (amountShares === null || amountShares === 0n) return null;
    const spacing = 1;
    const tick = alignTick(priceToTick(limitProb), spacing, false);
    const cur = selectedCurTick(selected);
    let error: string | null = null;
    if (side === "buy") {
      if (cur !== null && tick + spacing > cur) error = "Bid is above the market — lower the price or use Market.";
      return { tick, spacing, fn: "depositBid" as const, escrow: limitProb * Number(amountShares) / 10 ** baseDec, error };
    }
    if (cur !== null && tick <= cur) error = "Ask is below the market — raise the price or use Market.";
    return { tick, spacing, fn: "deposit" as const, escrow: Number(amountShares) / 10 ** baseDec, error };
  }, [mode, selected, limitProb, amountShares?.toString(), side, baseDec]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- range order: rest liquidity across a [from, to] price band (Frontier's
  // concentrated-liquidity primitive — deposit/depositBid take a tick range).
  const rangeLo = parseCentsDraft(band.lo);
  const rangeHi = parseCentsDraft(band.hi);
  const rangePlan = useMemo(() => {
    if (mode !== "range" || amountShares === null || amountShares === 0n) return null;
    if (rangeLo === null || rangeHi === null) return null;
    const loProb = rangeLo / 100;
    const hiProb = rangeHi / 100;
    const fn = side === "buy" ? ("depositBid" as const) : ("deposit" as const);
    const bad = (error: string) => ({
      loCents: rangeLo,
      hiCents: rangeHi,
      loTick: 0,
      hiTick: 0,
      levels: 0,
      liqPerLevel: 0n,
      fn,
      escrow: 0,
      error,
      loProb,
      hiProb,
    });
    if (!(rangeLo >= 1 && rangeHi <= 99)) return bad("Use prices between 1¢ and 99¢.");
    if (!(rangeLo < rangeHi)) return bad("Set a 'from' price below the 'to' price.");
    const loTick = alignTick(priceToTick(loProb), 1, false);
    const hiTick = Math.max(loTick + 1, alignTick(priceToTick(hiProb), 1, true));
    const levels = Math.max(1, hiTick - loTick);
    const liqPerLevel = amountShares / BigInt(levels);
    const cur = selectedCurTick(selected);
    let error: string | null = null;
    if (liqPerLevel === 0n) error = "Amount too small to spread across this band.";
    if (side === "buy" && cur !== null && hiTick >= cur) error = error ?? "A buy band must sit below the market.";
    if (side === "sell" && cur !== null && loTick <= cur) error = error ?? "A sell band must sit above the market.";
    const escrow =
      side === "buy"
        ? ((loProb + hiProb) / 2) * (Number(amountShares) / 10 ** baseDec)
        : Number(amountShares) / 10 ** baseDec;
    return { loCents: rangeLo, hiCents: rangeHi, loTick, hiTick, levels, liqPerLevel, fn, escrow, error, loProb, hiProb };
  }, [mode, rangeLo, rangeHi, amountShares?.toString(), side, selected, baseDec]); // eslint-disable-line react-hooks/exhaustive-deps

  // sensible defaults when entering a resting-order mode (and flip the band to the
  // correct side of the market when you toggle buy/sell)
  useEffect(() => {
    if (mode === "market") return;
    const m = selected.prob ? Math.round(selected.prob * 100) : 50;
    if (mode === "limit") {
      setLimitCentsStr(String(side === "buy" ? Math.max(1, m - 1) : Math.min(99, m + 1)));
    } else {
      // band just below/above the touch — a concentrated LP position you can then
      // drag wider on the ladder; kept near the touch so it doesn't blow out the axis
      setBand(defaultRangeBand(m, side));
    }
    setAmountStr((a) => a || "100");
  }, [mode, side]); // eslint-disable-line react-hooks/exhaustive-deps

  // project the order onto the depth view
  useEffect(() => {
    if (!onPreview) return;
    if (mode === "market" && derived) {
      const touch = side === "buy" ? selected.bestAsk ?? selected.prob : selected.bestBid ?? selected.prob;
      onPreview({
        outcome,
        mode: "market",
        side,
        fromProb: touch ?? derived.avgPrice,
        toProb: derived.endProb,
        avgProb: derived.avgPrice,
        shares: derived.shares,
        cost: derived.cost,
      });
    } else if (mode === "limit" && limitProb !== null && limitPlan && amountShares !== null && amountShares > 0n) {
      onPreview({
        outcome,
        mode: "limit",
        side,
        fromProb: limitProb,
        toProb: limitProb,
        avgProb: limitProb,
        shares: Number(amountShares) / 10 ** baseDec,
        cost: limitPlan.escrow,
      });
    } else if (mode === "range" && rangePlan && !rangePlan.error && amountShares !== null) {
      onPreview({
        outcome,
        mode: "range",
        side,
        fromProb: rangePlan.loProb,
        toProb: rangePlan.hiProb,
        avgProb: (rangePlan.loProb + rangePlan.hiProb) / 2,
        shares: Number(amountShares) / 10 ** baseDec,
        cost: rangePlan.escrow,
      });
    } else {
      onPreview(null);
    }
  }, [onPreview, mode, side, outcome, derived, limitProb, limitPlan, rangePlan, amountShares, selected, baseDec]);
  useEffect(() => () => onPreview?.(null), [onPreview]);

  const needsApproval =
    mode === "market" && allowance !== null && amountIn !== null && amountIn > 0n && allowance < amountIn;
  const limitPayToken = side === "buy" ? collateral : outcomeToken;
  const restingRequired = useMemo(() => {
    if (mode === "limit") {
      if (!limitPlan || limitPlan.error !== null || amountShares === null) return null;
      return side === "buy" ? quoteUnitsFromApprox(limitPlan.escrow, quoteDec) : amountShares;
    }
    if (mode === "range") {
      if (!rangePlan || rangePlan.error !== null || amountShares === null) return null;
      return side === "buy" ? quoteUnitsFromApprox(rangePlan.escrow, quoteDec) : amountShares;
    }
    return null;
  }, [mode, limitPlan, rangePlan, amountShares, side, quoteDec]);
  const requiredAmount = mode === "market" ? amountIn : restingRequired;
  const balanceForOrder = side === "buy" ? balances.usdc : shareBalance;
  const insufficient = requiredAmount !== null && requiredAmount > balanceForOrder;
  // quoted but the book has nothing on the side we'd hit (thin/illiquid book)
  const noLiquidity =
    mode === "market" &&
    amountIn !== null &&
    amountIn > 0n &&
    ((quote !== null && quote.out === 0n) || quoteErr !== null);
  const canMerge = balances.weth > 0n && balances.no > 0n;

  const onApproveRouter = () =>
    sendTx(`Approve ${side === "buy" ? quoteSym : outcome}`, () =>
      wallet.writeContract({
        address: tokenIn,
        abi: erc20Abi,
        functionName: "approve",
        args: [cfg.contracts.router, MAX_UINT],
      }),
    ).then(() => loadAllowance());

  const onApproveBook = () =>
    book
      ? sendTx(`Approve ${side === "buy" ? quoteSym : outcome} for book`, () =>
          wallet.writeContract({
            address: limitPayToken!,
            abi: erc20Abi,
            functionName: "approve",
            args: [book, MAX_UINT],
          }),
        ).then(() => loadBookAllowance())
      : Promise.resolve();

  const onMarket = async () => {
    if (!book || amountIn === null || derived === null) return;
    const { timestamp } = await client.getBlock({ blockTag: "latest" });
    const deadline = timestamp + 600n;
    const label =
      side === "buy"
        ? `Buy ${outcome} · ${fmtUsd(derived.cost)}`
        : `Sell ${outcome} · ${fmtAmount(amountIn, 2, baseDec)} sh`;
    const ok = await sendTx(label, () =>
      wallet.writeContract({
        address: cfg.contracts.router,
        abi: routerAbi,
        functionName: side === "buy" ? "buyExactIn" : "sellExactIn",
        args: [book, amountIn, minOut, addr, deadline],
      }),
    );
    if (ok) setAmountStr("");
  };

  const onLimit = async () => {
    if (!book || !limitPlan || limitPlan.error !== null || amountShares === null) return;
    const label = `Limit ${side} ${outcome} @ ${limitCents}¢`;
    const ok = await sendTx(label, () =>
      wallet.writeContract({
        address: book,
        abi: bookAbi,
        functionName: limitPlan.fn,
        args: [limitPlan.tick, limitPlan.tick + limitPlan.spacing, amountShares],
      }),
    );
    if (ok) setAmountStr("");
  };

  const onRange = async () => {
    if (!book || !rangePlan || rangePlan.error !== null) return;
    const label = `Range ${side} ${outcome} ${formatCentsInput(rangePlan.loCents)}–${formatCentsInput(rangePlan.hiCents)}¢`;
    const ok = await sendTx(label, () =>
      wallet.writeContract({
        address: book,
        abi: bookAbi,
        functionName: rangePlan.fn,
        args: [rangePlan.loTick, rangePlan.hiTick, rangePlan.liqPerLevel],
      }),
    );
    if (ok) setAmountStr("");
  };

  const yesPx = yes.prob;
  const noPx = no.prob;
  const rangeAvgProb =
    rangeLo !== null && rangeHi !== null && rangeLo > 0 && rangeLo < rangeHi ? (rangeLo + rangeHi) / 200 : null;
  const restingMaxProb = mode === "limit" ? limitProb : mode === "range" ? rangeAvgProb : null;
  const amountLabel =
    mode === "market" && side === "buy"
      ? "Amount"
      : mode === "market"
        ? "Shares"
        : side === "buy"
          ? "Shares to bid"
          : "Shares to list";
  const balanceLabel =
    side === "buy" ? `${fmtAmount(balances.usdc, 2, quoteDec)} ${quoteSym}` : `${fmtAmount(shareBalance, 2, baseDec)} sh`;
  const fillMaxAmount = () => {
    if (side === "buy") {
      const quoteBalance = Number(balances.usdc) / 10 ** quoteDec;
      if (mode === "market") {
        setAmountStr(formatNumberInput(quoteBalance, 4));
      } else if (restingMaxProb !== null && restingMaxProb > 0) {
        setAmountStr(formatNumberInput(quoteBalance / restingMaxProb, 4));
      }
      return;
    }
    setAmountStr(formatNumberInput(Number(shareBalance) / 10 ** baseDec, 4));
  };

  return (
    <div className="dbx-ticket-inner">
      {/* Buy / Sell + order type */}
      <div className="dbx-ticket-top">
        <div className="dbx-bs">
          <button className={side === "buy" ? "on" : ""} onClick={() => setSide("buy")}>
            Buy
          </button>
          <button className={side === "sell" ? "on" : ""} onClick={() => setSide("sell")}>
            Sell
          </button>
        </div>
        <div className="dbx-mode-seg" title="Order type">
          {(["market", "limit", "range"] as Mode[]).map((m) => (
            <button
              key={m}
              className={mode === m ? "on" : ""}
              onClick={() => setMode(m)}
            >
              {m === "market" ? "Market" : m === "limit" ? "Limit" : "Range"}
            </button>
          ))}
        </div>
      </div>

      {/* YES / NO selector */}
      <div className="dbx-outcome-pick">
        <button
          className={`dbx-pick yes ${isYes ? "on" : ""}`}
          onClick={() => onOutcome("YES")}
        >
          <span>Yes</span>
          <strong className="num">{fmtCents(yesPx)}</strong>
        </button>
        <button
          className={`dbx-pick no ${!isYes ? "on" : ""}`}
          onClick={() => onOutcome("NO")}
        >
          <span>No</span>
          <strong className="num">{fmtCents(noPx)}</strong>
        </button>
      </div>

      {mode === "limit" && (
        <div className="dbx-field">
          <label className="dbx-field-label">Limit price</label>
          <div className="dbx-stepper">
            <button onClick={() => setLimitCentsStr(String(Math.max(1, (Number(limitCentsStr) || 0) - 1)))}>−</button>
            <input
              className="num"
              inputMode="numeric"
              placeholder={selected.prob ? String(Math.round(selected.prob * 100)) : "50"}
              value={limitCentsStr}
              onChange={(e) => setLimitCentsStr(e.target.value.replace(/[^\d]/g, ""))}
            />
            <span className="suffix">¢</span>
            <button onClick={() => setLimitCentsStr(String(Math.min(99, (Number(limitCentsStr) || 0) + 1)))}>+</button>
          </div>
        </div>
      )}

      {mode === "range" && (
        <div className="dbx-field">
          <label className="dbx-field-label">
            Price band <span className="dim">({side === "buy" ? "below" : "above"} market — fills as price moves through)</span>
          </label>
          <div className="dbx-range-inputs">
            <div className="dbx-stepper sm">
              <input
                className="num"
                inputMode="decimal"
                placeholder="from"
                value={band.lo}
                onBlur={() =>
                  setBand((prev) => ({ ...prev, lo: finalizeCentsDraft(prev.lo) }))
                }
                onChange={(e) =>
                  setBand((prev) => ({ ...prev, lo: cleanCentsDraft(e.target.value) }))
                }
              />
              <span className="suffix">¢</span>
            </div>
            <span className="dbx-range-dash">→</span>
            <div className="dbx-stepper sm">
              <input
                className="num"
                inputMode="decimal"
                placeholder="to"
                value={band.hi}
                onBlur={() =>
                  setBand((prev) => ({ ...prev, hi: finalizeCentsDraft(prev.hi) }))
                }
                onChange={(e) =>
                  setBand((prev) => ({ ...prev, hi: cleanCentsDraft(e.target.value) }))
                }
              />
              <span className="suffix">¢</span>
            </div>
          </div>
        </div>
      )}

      {/* amount */}
      <div className="dbx-field">
        <label className="dbx-field-label">
          {amountLabel}
          <button className="dbx-bal num" onClick={fillMaxAmount}>
            {balanceLabel}
          </button>
        </label>
        <div className="dbx-amount">
          {side === "buy" && mode === "market" && <span className="dbx-amount-cur">$</span>}
          <input
            className="num"
            inputMode="decimal"
            placeholder="0"
            value={amountStr}
            onChange={(e) => setAmountStr(e.target.value)}
          />
        </div>
        <div className="dbx-presets">
          {(side === "buy" && mode === "market" ? [1, 20, 100, 500] : [10, 50, 100, 500]).map((v, i) => (
            <button
              key={v}
              className={i === 3 ? "accentish" : ""}
              onClick={() =>
                setAmountStr((prev) => String((Number(prev) || 0) + v))
              }
            >
              +{v}
            </button>
          ))}
          <button onClick={() => setAmountStr("")}>Clear</button>
        </div>
      </div>

      {/* summary rows */}
      <div className="dbx-ticket-rows num">
        {mode === "market" ? (
          <>
            <Row label="Avg price" value={derived ? fmtCents(derived.avgPrice, 1) : "—"} />
            <Row
              label={side === "buy" ? "Est. shares" : "Est. receive"}
              value={
                derived
                  ? side === "buy"
                    ? `${derived.shares.toFixed(2)}`
                    : `${fmtUsd(derived.cost)}`
                  : "—"
              }
            />
            <Row label="Total" value={derived ? fmtUsd(derived.cost) : "$0.00"} strong tone="accent" />
            {side === "buy" && (
              <Row
                label="To win 💸"
                value={derived ? fmtUsd(derived.cost + derived.toWin) : "$0.00"}
                strong
                tone="yes"
              />
            )}
          </>
        ) : mode === "limit" ? (
          <>
            <Row label="Rests at" value={limitProb !== null ? fmtCents(limitProb) : "—"} />
            <Row
              label={side === "buy" ? "You escrow" : "You provide"}
              value={limitPlan ? (side === "buy" ? fmtUsd(limitPlan.escrow) : `${limitPlan.escrow.toFixed(2)} sh`) : "—"}
            />
            <Row label="Expiry" value="Never — claim or cancel" />
          </>
        ) : (
          <>
            <Row
              label="Band"
              value={rangePlan ? `${fmtCents(rangePlan.loProb)} – ${fmtCents(rangePlan.hiProb)}` : "—"}
            />
            <Row
              label={side === "buy" ? "You escrow" : "You provide"}
              value={rangePlan ? (side === "buy" ? fmtUsd(rangePlan.escrow) : `${rangePlan.escrow.toFixed(2)} sh`) : "—"}
            />
            <Row label="Spread over" value={rangePlan && rangePlan.levels ? `${rangePlan.levels} ticks` : "—"} />
          </>
        )}
      </div>

      {derived?.partial && mode === "market" && (
        <div className="dbx-note warn">Book depth covers only part of your order; the rest stays in your wallet.</div>
      )}
      {mode === "limit" && limitPlan?.error && <div className="dbx-note warn">{limitPlan.error}</div>}
      {mode === "range" && rangePlan?.error && <div className="dbx-note warn">{rangePlan.error}</div>}
      {!tradable && (
        <div className="dbx-note warn">
          The NO book is not deployed in this manifest — NO is shown as the 1 − YES complement.
        </div>
      )}
      {noLiquidity && (
        <div className="dbx-note warn">
          No {outcome} {side === "buy" ? "asks to buy from" : "bids to sell into"} at this size — this book is thin
          right now.
          {side === "sell" && canMerge && (
            <>
              {" "}
              You hold YES + NO, so you can <strong>Merge</strong> the pair back to {quoteSym} in the Frontier Liquidity
              card below.
            </>
          )}
        </div>
      )}

      {/* CTA */}
      {renderCta()}

      <div className="dbx-terms">
        By trading you accept this is experimental testnet market software. <span className="dim">Funds move on-chain.</span>
      </div>
    </div>
  );

  function renderCta() {
    const disabled = busy !== null || !tradable;
    if (insufficient) {
      return (
        <button className="dbx-cta" disabled>
          Insufficient {side === "buy" ? quoteSym : "shares"}
        </button>
      );
    }
    if (mode === "market") {
      if (needsApproval) {
        return (
          <button className="dbx-cta approve" disabled={disabled} onClick={onApproveRouter}>
            Approve {side === "buy" ? quoteSym : outcome}
          </button>
        );
      }
      return (
        <button
          className={`dbx-cta ${side === "buy" ? "buy" : "sell"}`}
          disabled={disabled || amountIn === null || amountIn === 0n || derived === null}
          onClick={onMarket}
        >
          {noLiquidity
            ? `No ${outcome} ${side === "buy" ? "asks" : "bids"}`
            : side === "buy"
              ? `Buy ${outcome}`
              : `Sell ${outcome}`}
        </button>
      );
    }
    // limit / range — a resting order paid to the book
    const planOk =
      mode === "limit"
        ? limitPlan !== null && limitPlan.error === null
        : rangePlan !== null && rangePlan.error === null;
    const bookNeedsApproval = planOk && bookAllowance !== null && bookAllowance < MAX_UINT / 2n;
    if (bookNeedsApproval) {
      return (
        <button className="dbx-cta approve" disabled={disabled} onClick={onApproveBook}>
          Approve {side === "buy" ? quoteSym : outcome}
        </button>
      );
    }
    return (
      <button
        className={`dbx-cta ${side === "buy" ? "buy" : "sell"}`}
        disabled={disabled || !planOk}
        onClick={mode === "limit" ? onLimit : onRange}
      >
        {mode === "limit" ? "Place limit" : "Place range"} {side}
      </button>
    );
  }
}

function Row({
  label,
  value,
  strong,
  tone,
}: {
  label: string;
  value: string;
  strong?: boolean;
  tone?: "accent" | "yes";
}) {
  return (
    <div className={`dbx-row ${strong ? "strong" : ""} ${tone ?? ""}`}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}

function cleanCentsDraft(raw: string): string {
  const filtered = raw.replace(/[^\d.]/g, "");
  const dot = filtered.indexOf(".");
  if (dot === -1) return filtered;
  const whole = filtered.slice(0, dot).replace(/\./g, "");
  const decimals = filtered.slice(dot + 1).replace(/\./g, "").slice(0, 2);
  return `${whole}.${decimals}`;
}

function parseCentsDraft(value: string): number | null {
  const t = value.trim();
  if (!t || t === ".") return null;
  if (!/^\d+(?:\.\d{0,2})?$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function finalizeCentsDraft(value: string): string {
  const n = parseCentsDraft(value);
  if (n === null) return "";
  return formatCentsInput(Math.max(1, Math.min(99, n)));
}

function formatCentsInput(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.?0+$/, "");
}

function defaultRangeBand(midCents: number, side: Side): { lo: string; hi: string } {
  const mid = Math.max(1, Math.min(99, Math.round(midCents)));
  if (side === "buy") {
    const hi = Math.max(2, Math.min(98, mid - 1));
    const lo = Math.max(1, hi - 3);
    return { lo: String(lo), hi: String(Math.max(lo + 1, hi)) };
  }
  const lo = Math.min(98, Math.max(1, mid + 1));
  const hi = Math.min(99, lo + 3);
  return { lo: String(lo), hi: String(Math.max(lo + 1, hi)) };
}

function quoteUnitsFromApprox(value: number, decimals: number): bigint {
  if (!Number.isFinite(value) || value <= 0) return 0n;
  return BigInt(Math.ceil(value * 10 ** decimals));
}

function formatNumberInput(value: number, dp: number): string {
  if (!Number.isFinite(value) || value <= 0) return "";
  return value.toFixed(dp).replace(/\.?0+$/, "");
}

/** Current tick of a book is not exposed on PredictionBook; infer "has an
 * open market in band" from its touches. Returns a coarse tick proxy or null. */
function selectedCurTick(b: PredictionBook): number | null {
  const px = b.prob;
  if (px === null) return null;
  return priceToTick(px);
}
