import { fmtCents, fmtPct, type Outcome, type PredictionBook, type PredictionLevel } from "../../lib/prediction";

/**
 * Liquidity depth histogram — replaces the YES/NO cards. Each resting price
 * level is a vertical bar whose HEIGHT is its liquidity (shares). Bids sit to
 * the left of the median (green), asks to the right (red), with the median
 * price marked dead center. Toggling Yes/No flips which book is shown.
 */
export function DepthBars({
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
  const book = outcome === "YES" ? yes : no;
  const bids = book.bidDepth.slice().sort((a, b) => a.probability - b.probability); // low → high price
  const asks = book.askDepth.slice().sort((a, b) => a.probability - b.probability);
  const levels: Array<PredictionLevel & { side: "bid" | "ask" }> = [
    ...bids.map((l) => ({ ...l, side: "bid" as const })),
    ...asks.map((l) => ({ ...l, side: "ask" as const })),
  ];
  const maxSize = Math.max(1, ...levels.map((l) => l.size));
  const mid = book.prob;
  const lo = levels[0]?.probability ?? null;
  const hi = levels[levels.length - 1]?.probability ?? null;

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
        {levels.length === 0 ? (
          <div className="dbx-depth-empty">No resting liquidity yet — awaiting market makers.</div>
        ) : (
          <div className="dbx-depth-bars">
            {bids.length > 0 && (
              <div className="dbx-depth-half bids">
                {bids.map((l, i) => (
                  <Bar key={`b${i}`} level={l} maxSize={maxSize} side="bid" />
                ))}
              </div>
            )}
            <div className="dbx-depth-center" title={`median ${fmtCents(mid)}`}>
              <span className="dbx-depth-center-px num">{fmtCents(mid)}</span>
            </div>
            {asks.length > 0 && (
              <div className="dbx-depth-half asks">
                {asks.map((l, i) => (
                  <Bar key={`a${i}`} level={l} maxSize={maxSize} side="ask" />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="dbx-depth-axis num">
        <span>{lo !== null ? fmtCents(lo, 0) : "—"}</span>
        <span className="dim">bid liquidity · ask liquidity</span>
        <span>{hi !== null ? fmtCents(hi, 0) : "—"}</span>
      </div>
    </section>
  );
}

function Bar({ level, maxSize, side }: { level: PredictionLevel; maxSize: number; side: "bid" | "ask" }) {
  const h = Math.max(4, (level.size / maxSize) * 100);
  return (
    <div
      className={`dbx-depth-col ${side}`}
      title={`${fmtCents(level.probability, 1)} · ${level.size.toLocaleString("en-US", { maximumFractionDigits: 2 })} sh`}
    >
      <div className="dbx-depth-bar" style={{ height: `${h}%` }} />
    </div>
  );
}
