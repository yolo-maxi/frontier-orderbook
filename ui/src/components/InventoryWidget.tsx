import { useEffect, useMemo, useRef } from "react";
import { formatUnits } from "viem";
import { useApp } from "../state/app";
import { fmtNum, fmtPrice, tickToPrice } from "../lib/format";
import { baseDecimals, quoteDecimals } from "../lib/config";

/**
 * U1 — Inventory / live PnL widget.
 *
 * Everything here is derived from CLIENT state (wallet balances, open maker
 * positions, the live mid). With no historical cost basis available on-chain
 * we anchor PnL to a SESSION baseline: the first portfolio mark this widget
 * sees becomes the reference, and PnL is measured against it. That gives a
 * faithful mark-to-market for the trading session without an indexer.
 *
 * INDEXER NOTE: a true realized/unrealized split, all-time PnL, average entry
 * and fee accounting needs historical fills keyed by the maker. Once the
 * indexer exposes per-account fill history we replace the session baseline
 * with a real cost basis and surface realized vs. unrealized separately. The
 * spots that change are flagged inline below.
 */

interface Mark {
  /** total portfolio value in quote units (USDC) */
  value: number;
  /** signed base-token exposure (delta) in base units */
  delta: number;
  /** value locked in resting / claimable maker positions, quote units */
  inPositions: number;
  /** free wallet value, quote units */
  free: number;
}

export function InventoryWidget() {
  const { cfg, balances, positions, summary, market } = useApp();
  const baseDec = baseDecimals(cfg);
  const quoteDec = quoteDecimals(cfg);
  const mid = summary ? tickToPrice(summary.currentTick) : null;

  const mark = useMemo<Mark | null>(() => {
    if (mid === null) return null;
    const weth = Number(formatUnits(balances.weth, baseDec));
    const usdc = Number(formatUnits(balances.usdc, quoteDec));

    // Resting maker capital + claimable proceeds, marked at the live price.
    // Ask: resting principal is base (mark at mid), claimable is quote.
    // Bid: resting principal is quote, claimable is base (mark at mid).
    let posBase = 0; // base exposure tied up in positions
    let posQuote = 0; // quote tied up in positions
    for (const p of positions) {
      if (!p.live) continue;
      if (p.isBid) {
        posQuote += Number(formatUnits(p.unfilled, quoteDec)); // resting quote
        posBase += Number(formatUnits(p.claimable, baseDec)); // bought base, unclaimed
      } else {
        posBase += Number(formatUnits(p.unfilled, baseDec)); // resting base
        posQuote += Number(formatUnits(p.claimable, quoteDec)); // sold for quote, unclaimed
      }
    }

    const baseExposure = weth + posBase; // total base held + escrowed
    const free = usdc + weth * mid;
    const inPositions = posQuote + posBase * mid;
    const value = free + inPositions;
    return { value, delta: baseExposure, inPositions, free };
  }, [mid, balances, positions, baseDec, quoteDec]);

  // Session baseline: first non-null mark anchors session PnL.
  const baselineRef = useRef<number | null>(null);
  useEffect(() => {
    if (mark && baselineRef.current === null && mark.value > 0) {
      baselineRef.current = mark.value;
    }
  }, [mark]);

  if (!mark || mid === null) {
    return (
      <div className="inv-widget">
        <div className="inv-head">
          <span className="inv-title">Inventory</span>
        </div>
        <div className="empty-state inv-empty">marking to market…</div>
      </div>
    );
  }

  const baseline = baselineRef.current;
  const pnl = baseline !== null ? mark.value - baseline : 0;
  const pnlPct = baseline && baseline > 0 ? (pnl / baseline) * 100 : 0;
  const pnlCls = pnl > 1e-6 ? "up" : pnl < -1e-6 ? "down" : "";
  // delta value (notional of net base exposure) drives inventory-skew warnings
  const deltaValue = mark.delta * mid;
  const skew = mark.value > 0 ? deltaValue / mark.value : 0;
  const skewCls = Math.abs(skew) > 0.6 ? "warn" : "";

  return (
    <div className="inv-widget">
      <div className="inv-head">
        <span className="inv-title">Inventory · live PnL</span>
        <span className="inv-mark num dim" title="Live mark price from the book">
          mark {fmtPrice(mid, 3)}
        </span>
      </div>
      <div className="inv-pnl">
        <span className={`inv-pnl-val num ${pnlCls}`}>
          {pnl >= 0 ? "+" : "−"}
          {fmtNum(Math.abs(pnl), 2)}
          <span className="inv-pnl-unit"> {market.quoteSymbol}</span>
        </span>
        <span className={`inv-pnl-pct num ${pnlCls}`}>
          {pnl >= 0 ? "+" : "−"}
          {Math.abs(pnlPct).toFixed(2)}%
        </span>
        <span className="inv-pnl-tag dim">session</span>
      </div>
      <div className="inv-grid num">
        <div className="inv-cell">
          <span className="dim">Portfolio</span>
          <span>
            {fmtNum(mark.value, 2)} <span className="dim">{market.quoteSymbol}</span>
          </span>
        </div>
        <div className="inv-cell">
          <span className="dim">Net {market.baseSymbol} (Δ)</span>
          <span className={Math.abs(mark.delta) < 1e-9 ? "dim" : ""}>
            {mark.delta >= 0 ? "+" : "−"}
            {fmtNum(Math.abs(mark.delta), 4)}
          </span>
        </div>
        <div className="inv-cell">
          <span className="dim">Free</span>
          <span>{fmtNum(mark.free, 2)}</span>
        </div>
        <div className="inv-cell">
          <span className="dim">In quotes</span>
          <span>{fmtNum(mark.inPositions, 2)}</span>
        </div>
      </div>
      <div className="inv-skew">
        <div className="inv-skew-track">
          <span className="inv-skew-mid" />
          <span
            className={`inv-skew-fill ${skew >= 0 ? "skew-long" : "skew-short"} ${skewCls}`}
            style={{
              left: skew >= 0 ? "50%" : `${50 + Math.max(-50, skew * 50)}%`,
              width: `${Math.min(50, Math.abs(skew) * 50)}%`,
            }}
          />
        </div>
        <span className={`inv-skew-label num ${skewCls}`}>
          {Math.abs(skew) < 0.01
            ? "delta-neutral"
            : `${skew > 0 ? "long" : "short"} ${Math.abs(skew * 100).toFixed(0)}% of book`}
        </span>
      </div>
    </div>
  );
}
