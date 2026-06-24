import { useState } from "react";
import { fmtCents, fmtPct, type Outcome, type PredictionBook, type PredictionLevel } from "../../lib/prediction";

export function OrderBookCard({
  outcome,
  onOutcome,
  yes,
  no,
}: {
  outcome: Outcome;
  onOutcome: (o: Outcome) => void;
  yes: PredictionBook;
  no: PredictionBook;
}) {
  const [open, setOpen] = useState(true);
  const book = outcome === "YES" ? yes : no;
  const asks = book.askDepth.slice().reverse(); // highest ask first, descending to spread
  const bids = book.bidDepth; // already high -> low
  const maxCum = Math.max(1, ...book.askDepth.map((d) => d.cum), ...book.bidDepth.map((d) => d.cum));
  const empty = asks.length === 0 && bids.length === 0;

  return (
    <section className="dbx-ob panel">
      <button className="dbx-ob-head" onClick={() => setOpen((o) => !o)}>
        <span className="dbx-ob-title">Order Book</span>
        <span className="dbx-ob-hint dim">{book.source === "synthetic" ? "complement view" : "live depth"}</span>
        <span className={`dbx-chevron ${open ? "up" : ""}`}>⌃</span>
      </button>

      {open && (
        <div className="dbx-ob-body">
          <div className="dbx-ob-tabs">
            <button className={outcome === "YES" ? "on yes" : ""} onClick={() => onOutcome("YES")}>
              Trade Yes
            </button>
            <button className={outcome === "NO" ? "on no" : ""} onClick={() => onOutcome("NO")}>
              Trade No
            </button>
            <span className="dbx-ob-spacer" />
            <span className="dbx-ob-rewards">◇ Rewards</span>
          </div>

          <div className="dbx-ob-cols num">
            <span>PRICE</span>
            <span className="ta-r">SHARES</span>
            <span className="ta-r">TOTAL</span>
          </div>

          {empty ? (
            <div className="dbx-ob-empty">
              No resting orders yet. Once market makers (or the demo bots) post liquidity, the ladder fills in here.
            </div>
          ) : (
            <>
              <div className="dbx-ob-side">
                {asks.map((l, i) => (
                  <DepthRow key={`a${i}-${l.tick}`} level={l} maxCum={maxCum} side="ask" />
                ))}
                <div className="dbx-ob-tag ask">Asks</div>
              </div>

              <div className="dbx-ob-mid num">
                <span>
                  Last <strong>{fmtCents(book.last)}</strong>
                </span>
                <span className="dim">
                  Spread {book.spread !== null ? fmtPct(book.spread, 1) : "—"}
                </span>
              </div>

              <div className="dbx-ob-side">
                <div className="dbx-ob-tag bid">Bids</div>
                {bids.map((l, i) => (
                  <DepthRow key={`b${i}-${l.tick}`} level={l} maxCum={maxCum} side="bid" />
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}

function DepthRow({ level, maxCum, side }: { level: PredictionLevel; maxCum: number; side: "ask" | "bid" }) {
  const total = level.cum * level.probability; // cumulative sUSDC notional
  return (
    <div className="dbx-ob-row num">
      <span className={`dbx-ob-bar ${side}`} style={{ width: `${Math.min(100, (level.cum / maxCum) * 100)}%` }} />
      <span className={side === "ask" ? "ask" : "bid"}>{fmtCents(level.probability, 1)}</span>
      <span className="ta-r">{level.size.toLocaleString("en-US", { maximumFractionDigits: 2 })}</span>
      <span className="ta-r dim">
        {total.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })}
      </span>
    </div>
  );
}
