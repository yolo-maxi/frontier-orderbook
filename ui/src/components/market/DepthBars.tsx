import { fmtCents, fmtPct, type Outcome, type OrderPreview, type PredictionBook, type PredictionLevel } from "../../lib/prediction";

/**
 * Liquidity depth view — bids (green) left of the median, asks (red) right, bar
 * height = resting size. When you're composing an order it projects onto the
 * book: a market order shades the levels it sweeps and marks its average fill; a
 * limit order drops a marker where it would rest. A plain-English line spells out
 * exactly what the order does.
 */
export function DepthBars({
  outcome,
  onOutcome,
  yes,
  no,
  preview,
}: {
  outcome: Outcome;
  onOutcome: (o: Outcome) => void;
  yes: PredictionBook;
  no: PredictionBook;
  preview?: OrderPreview | null;
}) {
  const book = outcome === "YES" ? yes : no;
  const bids = book.bidDepth.slice().sort((a, b) => a.probability - b.probability); // low → high price
  const asks = book.askDepth.slice().sort((a, b) => a.probability - b.probability);
  const maxSize = Math.max(1, ...bids.map((l) => l.size), ...asks.map((l) => l.size));
  const mid = book.prob;
  const empty = bids.length === 0 && asks.length === 0;
  const pv = preview && preview.outcome === outcome ? preview : null;

  // which side/levels does the pending order touch?
  const hit = (l: PredictionLevel, side: "bid" | "ask"): boolean => {
    if (!pv) return false;
    if (pv.mode === "market") {
      if (pv.side === "buy") return side === "ask" && l.probability <= pv.toProb + 1e-9;
      return side === "bid" && l.probability >= pv.toProb - 1e-9;
    }
    if (pv.mode === "range") {
      const lo = Math.min(pv.fromProb, pv.toProb);
      const hi = Math.max(pv.fromProb, pv.toProb);
      const bandSide = pv.side === "buy" ? "bid" : "ask";
      return side === bandSide && l.probability >= lo - 1e-9 && l.probability <= hi + 1e-9;
    }
    return false;
  };
  // a limit order rests on one side at a single price
  const limitSide: "bid" | "ask" | null = pv?.mode === "limit" ? (pv.side === "buy" ? "bid" : "ask") : null;

  return (
    <section className="dbx-depth panel">
      <div className="dbx-depth-head">
        <div className="dbx-depth-toggle">
          <button className={outcome === "YES" ? "on yes" : ""} onClick={() => onOutcome("YES")}>
            Yes <span className="num">{fmtCents(yes.prob)}</span>
          </button>
          <button className={outcome === "NO" ? "on no" : ""} onClick={() => onOutcome("NO")}>
            No <span className="num">{fmtCents(no.prob)}</span>
          </button>
        </div>
        <div className="dbx-depth-median">
          <span className="dim">median</span>
          <strong className={`num ${outcome === "YES" ? "yes-tone" : "no-tone"}`}>{fmtPct(mid)}</strong>
        </div>
      </div>

      <div className="dbx-depth-plot">
        {empty ? (
          <div className="dbx-depth-empty">No resting liquidity yet — awaiting market makers.</div>
        ) : (
          <div className="dbx-depth-bars">
            <div className="dbx-depth-half bids">
              {bids.map((l, i) => (
                <Bar key={`b${i}`} level={l} maxSize={maxSize} side="bid" hit={hit(l, "bid")} />
              ))}
              {limitSide === "bid" && <Marker side="bid" />}
            </div>
            <div className="dbx-depth-center" title={`median ${fmtCents(mid)}`}>
              <span className="dbx-depth-center-px num">{fmtCents(mid)}</span>
            </div>
            <div className="dbx-depth-half asks">
              {limitSide === "ask" && <Marker side="ask" />}
              {asks.map((l, i) => (
                <Bar key={`a${i}`} level={l} maxSize={maxSize} side="ask" hit={hit(l, "ask")} />
              ))}
            </div>
          </div>
        )}
      </div>

      {pv ? (
        <div className={`dbx-depth-order ${pv.side}`}>
          {pv.mode === "market" ? (
            <>
              <span className="dbx-order-tag">{pv.side === "buy" ? "Buy" : "Sell"} {pv.outcome}</span>
              <span className="num">
                ~{pv.shares.toFixed(1)} sh · avg <strong>{fmtCents(pv.avgProb, 1)}</strong> · {fmtUsdShort(pv.cost)}
              </span>
              <span className="dbx-order-move num dim">
                moves {fmtCents(pv.fromProb, 1)} → {fmtCents(pv.toProb, 1)}
              </span>
            </>
          ) : pv.mode === "limit" ? (
            <>
              <span className="dbx-order-tag">Limit {pv.side}</span>
              <span className="num">
                rest {pv.shares.toFixed(1)} sh @ <strong>{fmtCents(pv.avgProb, 1)}</strong> · escrow {fmtUsdShort(pv.cost)}
              </span>
            </>
          ) : (
            <>
              <span className="dbx-order-tag">Range {pv.side}</span>
              <span className="num">
                {pv.shares.toFixed(1)} sh across{" "}
                <strong>
                  {fmtCents(Math.min(pv.fromProb, pv.toProb), 0)}–{fmtCents(Math.max(pv.fromProb, pv.toProb), 0)}
                </strong>{" "}
                · {pv.side === "buy" ? `escrow ${fmtUsdShort(pv.cost)}` : `provide ${pv.shares.toFixed(1)} sh`}
              </span>
            </>
          )}
        </div>
      ) : (
        <div className="dbx-depth-axis num">
          <span>{bids.length ? fmtCents(bids[0].probability, 0) : "—"}</span>
          <span className="dim">resting liquidity · type an order to preview where it lands</span>
          <span>{asks.length ? fmtCents(asks[asks.length - 1].probability, 0) : "—"}</span>
        </div>
      )}
    </section>
  );
}

function Bar({ level, maxSize, side, hit }: { level: PredictionLevel; maxSize: number; side: "bid" | "ask"; hit: boolean }) {
  const h = Math.max(4, (level.size / maxSize) * 100);
  return (
    <div
      className={`dbx-depth-col ${side} ${hit ? "hit" : ""}`}
      title={`${fmtCents(level.probability, 1)} · ${level.size.toLocaleString("en-US", { maximumFractionDigits: 1 })} sh`}
    >
      <div className="dbx-depth-bar" style={{ height: `${h}%` }} />
    </div>
  );
}

function Marker({ side }: { side: "bid" | "ask" }) {
  return <div className={`dbx-depth-marker ${side}`} title="your limit order rests here" />;
}

function fmtUsdShort(n: number): string {
  return `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}
