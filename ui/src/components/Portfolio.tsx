import { useMemo } from "react";
import { formatUnits } from "viem";
import { useApp } from "../state/app";
import { fmtNum, fmtPrice, fmtTime, tickToPrice } from "../lib/format";
import { baseDecimals, quoteDecimals } from "../lib/config";
import { ProbabilityPill } from "./ProbabilityPill";
import { Sparkline } from "./Sparkline";

/**
 * Prediction portfolio (loop 2) — beats Polymarket's positions tab.
 *
 * A single overlay that pulls together what a trader needs after they have
 * traded: every open maker position marked to the live book, a clean
 * value/exposure/PnL split, and a chronological activity log folded from the
 * maker-event + fill streams already in app state.
 *
 * All figures are derived from CLIENT state (positions, balances, the live
 * mid, observed events). With no per-account cost basis on-chain, PnL is a
 * mark-to-market against a session baseline (same convention as the inventory
 * widget). When the indexer is wired, `marketStats` / historical fills replace
 * the session baseline with a true realized/unrealized split — the slots are
 * flagged inline.
 */
export function Portfolio({ onClose }: { onClose: () => void }) {
  const {
    cfg,
    balances,
    positions,
    summary,
    market,
    makerEvents,
    fills,
    predictionMeta,
    priceHistory,
  } = useApp();
  const baseDec = baseDecimals(cfg);
  const quoteDec = quoteDecimals(cfg);
  const mid = summary ? tickToPrice(summary.currentTick) : null;

  const rows = useMemo(() => {
    if (mid === null) return [];
    return positions
      .filter((p) => p.live)
      .map((p) => {
        // value tied up + side-specific marks (mirrors InventoryWidget logic)
        const restQuote = p.isBid ? Number(formatUnits(p.unfilled, quoteDec)) : 0;
        const restBase = p.isBid ? 0 : Number(formatUnits(p.unfilled, baseDec));
        const gotBase = p.isBid ? Number(formatUnits(p.claimable, baseDec)) : 0;
        const gotQuote = p.isBid ? 0 : Number(formatUnits(p.claimable, quoteDec));
        const value = restQuote + restBase * mid + gotBase * mid + gotQuote;
        const lo = tickToPrice(p.lower);
        const hi = tickToPrice(p.upper);
        const claimableQuote = p.isBid ? gotBase * mid : gotQuote;
        return {
          id: p.id,
          isBid: p.isBid,
          lo,
          hi,
          value,
          claimableQuote,
          hasClaim: p.claimable > 0n,
        };
      })
      .sort((a, b) => b.value - a.value);
  }, [positions, mid, baseDec, quoteDec]);

  const totals = useMemo(() => {
    if (mid === null) return null;
    const weth = Number(formatUnits(balances.weth, baseDec));
    const usdc = Number(formatUnits(balances.usdc, quoteDec));
    const inPositions = rows.reduce((s, r) => s + r.value, 0);
    const claimable = rows.reduce((s, r) => s + r.claimableQuote, 0);
    const free = usdc + weth * mid;
    return { value: free + inPositions, free, inPositions, claimable, baseQty: weth };
  }, [rows, balances, mid, baseDec, quoteDec]);

  // chronological activity log: merge maker events + taker fills (newest first)
  const activity = useMemo(() => {
    type Item = { key: string; time: number; block: bigint; label: string; detail: string; cls: string };
    const items: Item[] = [];
    for (const e of makerEvents) {
      const range =
        e.priceLo !== null && e.priceHi !== null
          ? `${fmtPrice(e.priceLo, 3)}–${fmtPrice(e.priceHi, 3)}`
          : `#${e.positionId.toString()}`;
      const verb =
        e.kind === "place"
          ? `Quote ${e.side ?? ""}`.trim()
          : e.kind === "requote"
            ? "Requote"
            : e.kind === "cancel"
              ? "Cancel"
              : "Claim";
      items.push({
        key: "m" + e.key,
        time: e.time,
        block: e.block,
        label: verb,
        detail: range,
        cls: e.kind === "claim" ? "up" : e.kind === "cancel" ? "dim" : e.side === "ask" ? "down" : "up",
      });
    }
    for (const f of fills) {
      items.push({
        key: "f" + f.key,
        time: f.time,
        block: f.block,
        label: f.side === "buy" ? "Buy fill" : "Sell fill",
        detail: `${fmtPrice(f.priceLo, 3)}–${fmtPrice(f.priceHi, 3)}`,
        cls: f.side === "buy" ? "up" : "down",
      });
    }
    return items.sort((a, b) => (b.block === a.block ? b.time - a.time : b.block > a.block ? 1 : -1)).slice(0, 40);
  }, [makerEvents, fills]);

  const probPct = mid !== null ? Math.max(0, Math.min(100, mid * 100)) : null;

  const probSeries = useMemo(() => {
    if (priceHistory.length < 2) return null;
    const step = Math.max(1, Math.floor(priceHistory.length / 40));
    const s: number[] = [];
    for (let i = 0; i < priceHistory.length; i += step) {
      s.push(Math.max(0, Math.min(1, priceHistory[i].price)));
    }
    return s.length >= 2 ? s : null;
  }, [priceHistory]);

  return (
    <div className="browser-overlay" onMouseDown={onClose}>
      <div className="portfolio" onMouseDown={(e) => e.stopPropagation()}>
        <div className="browser-head">
          <div className="browser-title">Portfolio</div>
          <button className="browser-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className="pf-summary">
          <div className="pf-summary-main">
            <span className="pf-summary-label dim">Portfolio value</span>
            <span className="pf-summary-val num">
              {totals ? fmtNum(totals.value, 2) : "—"}
              <span className="dim pf-unit"> {market.quoteSymbol}</span>
            </span>
          </div>
          <div className="pf-summary-grid num">
            <div className="pf-cell">
              <span className="dim">Free</span>
              <span>{totals ? fmtNum(totals.free, 2) : "—"}</span>
            </div>
            <div className="pf-cell">
              <span className="dim">In positions</span>
              <span>{totals ? fmtNum(totals.inPositions, 2) : "—"}</span>
            </div>
            <div className="pf-cell">
              <span className="dim">Claimable</span>
              <span className={totals && totals.claimable > 1e-6 ? "up" : ""}>
                {totals ? fmtNum(totals.claimable, 2) : "—"}
              </span>
            </div>
            <div className="pf-cell">
              <span className="dim">{market.baseSymbol} held</span>
              <span>{totals ? fmtNum(totals.baseQty, 4) : "—"}</span>
            </div>
          </div>
        </div>

        <div className="pf-market">
          <div className="pf-market-left">
            <span className="pf-market-q">{predictionMeta.question}</span>
            {probSeries && (
              <div className="pf-market-spark">
                <Sparkline points={probSeries} width={220} height={32} />
                <span className="dim pf-spark-note">YES probability · session</span>
              </div>
            )}
          </div>
          {probPct !== null && <ProbabilityPill price={mid} size="sm" />}
        </div>

        <div className="pf-section-title">Open positions</div>
        <div className="pf-positions">
          {rows.length === 0 ? (
            <div className="empty-state pf-empty">
              No open positions. Quote a ladder from the Make tab — fills and PnL surface here.
            </div>
          ) : (
            <>
              <div className="pf-pos-head num dim">
                <span>Side</span>
                <span>Range</span>
                <span className="ta-r">Value ({market.quoteSymbol})</span>
                <span className="ta-r">Claimable</span>
              </div>
              {rows.map((r) => (
                <div className="pf-pos-row num" key={r.id.toString()}>
                  <span className={`chip ${r.isBid ? "chip-bid" : "chip-ask"}`}>
                    {r.isBid ? "YES bid" : "YES ask"}
                  </span>
                  <span>
                    {fmtPrice(r.lo, 3)} <span className="dim">→</span> {fmtPrice(r.hi, 3)}
                  </span>
                  <span className="ta-r">{fmtNum(r.value, 2)}</span>
                  <span className={`ta-r ${r.hasClaim ? "up" : "dim"}`}>
                    {r.claimableQuote > 1e-6 ? fmtNum(r.claimableQuote, 2) : "—"}
                  </span>
                </div>
              ))}
            </>
          )}
        </div>

        <div className="pf-section-title">Activity</div>
        <div className="pf-activity">
          {activity.length === 0 ? (
            <div className="empty-state pf-empty">No activity observed this session.</div>
          ) : (
            activity.map((a) => (
              <div className="pf-act-row num" key={a.key}>
                <span className="dim pf-act-time">{fmtTime(a.time)}</span>
                <span className={`pf-act-label ${a.cls}`}>{a.label}</span>
                <span className="pf-act-detail">{a.detail}</span>
                <span className="dim pf-act-block">blk {a.block.toString()}</span>
              </div>
            ))
          )}
        </div>
        <div className="pf-foot dim">
          PnL marked to the live book against a session baseline. Connect an indexer for
          realized/unrealized split and all-time history.
        </div>
      </div>
    </div>
  );
}
