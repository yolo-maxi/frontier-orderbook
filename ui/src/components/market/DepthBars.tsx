import { fmtCents, fmtPct, type Outcome, type OrderPreview, type PredictionBook, type PredictionLevel } from "../../lib/prediction";

/**
 * Liquidity depth view — bars positioned on an explicit price axis (mid centered,
 * bids green left / asks red right, height = resting size). The order you're
 * composing is drawn as a YELLOW BOX over the exact price region it occupies
 * (the band for a range, a thin slot for a limit, the swept span for a market
 * order), sitting under the bars so you can see both — i.e. literally where your
 * liquidity lands, even in empty space.
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
  const bids = book.bidDepth;
  const asks = book.askDepth;
  const all = [...bids, ...asks];
  const empty = all.length === 0;
  const mid = book.prob ?? 0.5;
  const pv = preview && preview.outcome === outcome ? preview : null;

  // symmetric price axis centred on mid, wide enough for every bar + the order
  const spans = [
    ...all.map((l) => Math.abs(l.probability - mid)),
    ...(pv ? [Math.abs(pv.fromProb - mid), Math.abs(pv.toProb - mid)] : []),
  ];
  const half = Math.max(0.006, ...spans) * 1.14;
  const pMin = mid - half;
  const pMax = mid + half;
  const x = (p: number) => Math.max(0, Math.min(100, ((p - pMin) / (2 * half)) * 100));
  const maxSize = Math.max(1, ...all.map((l) => l.size));
  const barW = Math.max(1.6, Math.min(4.5, 64 / Math.max(8, all.length)));

  // the yellow order box
  const lo = pv ? Math.min(pv.fromProb, pv.toProb) : 0;
  const hi = pv ? Math.max(pv.fromProb, pv.toProb) : 0;
  const boxLeft = x(lo);
  const boxW = pv ? Math.max(1.2, x(hi) - boxLeft) : 0; // min width so a limit slot is visible
  const boxLabel = pv?.mode === "range" ? "your range" : pv?.mode === "limit" ? "your limit" : "fills here";

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

      <div className="dbx-depth-plot2">
        {empty ? (
          <div className="dbx-depth-empty">No resting liquidity yet — awaiting market makers.</div>
        ) : (
          <>
            {pv && (
              <div className={`dbx-range-box ${pv.side}`} style={{ left: `${boxLeft}%`, width: `${boxW}%` }}>
                <span className="dbx-range-box-label">{boxLabel}</span>
              </div>
            )}
            <div className="dbx-mid-line" style={{ left: `${x(mid)}%` }} />
            {bids.map((l, i) => (
              <Bar key={`b${i}`} level={l} x={x(l.probability)} w={barW} h={(l.size / maxSize) * 100} side="bid" />
            ))}
            {asks.map((l, i) => (
              <Bar key={`a${i}`} level={l} x={x(l.probability)} w={barW} h={(l.size / maxSize) * 100} side="ask" />
            ))}
          </>
        )}
      </div>

      <div className="dbx-depth-axis2 num">
        <span>{fmtCents(pMin, 0)}</span>
        <span className="dbx-axis-mid">{fmtCents(mid)}</span>
        <span>{fmtCents(pMax, 0)}</span>
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
                {pv.shares.toFixed(1)} sh across <strong>{fmtCents(lo, 0)}–{fmtCents(hi, 0)}</strong> ·{" "}
                {pv.side === "buy" ? `escrow ${fmtUsdShort(pv.cost)}` : `provide ${pv.shares.toFixed(1)} sh`}
              </span>
            </>
          )}
        </div>
      ) : (
        <div className="dbx-depth-hint dim">resting liquidity · type an order to see where it lands</div>
      )}
    </section>
  );
}

function Bar({ level, x, w, h, side }: { level: PredictionLevel; x: number; w: number; h: number; side: "bid" | "ask" }) {
  return (
    <div
      className={`dbx-bar2 ${side}`}
      title={`${fmtCents(level.probability, 1)} · ${level.size.toLocaleString("en-US", { maximumFractionDigits: 1 })} sh`}
      style={{ left: `${x - w / 2}%`, width: `${w}%`, height: `${Math.max(3, h)}%` }}
    />
  );
}

function fmtUsdShort(n: number): string {
  return `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}
