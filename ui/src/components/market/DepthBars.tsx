import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { formatUnits } from "viem";
import { baseDecimals, quoteDecimals } from "../../lib/config";
import { fmtCents, fmtPct, type Outcome, type OrderPreview, type PredictionBook, type PredictionLevel } from "../../lib/prediction";
import { useApp } from "../../state/app";

type MirrorLiquidityDepth = {
  reserve0: bigint;
  reserve1: bigint;
};

/**
 * Liquidity depth view — bars on an explicit price axis (mid centred, bids green
 * left / asks red right, height = resting size). The order you're composing is a
 * YELLOW BOX over the exact price region it occupies, under the bars. When it's a
 * range order the box is DRAGGABLE: grab an edge to resize the band or the middle
 * to slide it, and the ticket's from/to follow.
 */
export function DepthBars({
  outcome,
  onOutcome,
  yes,
  no,
  mirrorLiquidity,
  preview,
  onDragRange,
}: {
  outcome: Outcome;
  onOutcome: (o: Outcome) => void;
  yes: PredictionBook;
  no: PredictionBook;
  mirrorLiquidity?: MirrorLiquidityDepth | null;
  preview?: OrderPreview | null;
  onDragRange?: (loCents: number, hiCents: number) => void;
}) {
  const { cfg } = useApp();
  const baseDec = baseDecimals(cfg);
  const quoteDec = quoteDecimals(cfg);
  const seedMirror = new URLSearchParams(window.location.search).get("seedMirror") === "1";
  const mirrorReserve0 = mirrorLiquidity?.reserve0 ?? 0n;
  const mirrorReserve1 = mirrorLiquidity?.reserve1 ?? 0n;
  const book = outcome === "YES" ? yes : no;
  const bids = book.bidDepth;
  const asks = book.askDepth;
  const all = [...bids, ...asks];
  const empty = all.length === 0;
  const mid = book.prob ?? 0.5;
  const pv = preview && preview.outcome === outcome ? preview : null;

  // ── drag the range box ──────────────────────────────────────────────
  const [dragging, setDragging] = useState(false);
  const plotRef = useRef<HTMLDivElement>(null);
  const axisRef = useRef({ pMin: 0, half: 1 });
  const frozen = useRef<{ pMin: number; half: number } | null>(null);
  const drag = useRef<null | { part: "lo" | "hi" | "move"; startLo: number; startHi: number; grab: number }>(null);

  // The price axis normally fits the bars (and the preview box, so you see where a
  // far order lands). But while you DRAG the box we freeze the axis — otherwise the
  // box would chase a rescaling axis and the drag would feel elastic and jumpy.
  const spans = [
    ...all.map((l) => Math.abs(l.probability - mid)),
    ...(pv ? [Math.abs(pv.fromProb - mid), Math.abs(pv.toProb - mid)] : []),
  ];
  const liveHalf = Math.max(0.006, ...spans) * 1.16;
  const half = dragging && frozen.current ? frozen.current.half : liveHalf;
  const pMin = dragging && frozen.current ? frozen.current.pMin : mid - half;
  const pMax = pMin + 2 * half;
  const x = (p: number) => Math.max(0, Math.min(100, ((p - pMin) / (2 * half)) * 100));
  axisRef.current = { pMin, half };
  const maxSize = Math.max(1, ...all.map((l) => l.size));
  const barW = Math.max(1.6, Math.min(4.5, 64 / Math.max(8, all.length)));
  const seededAskMirror = seedMirror && mirrorReserve0 === 0n ? maxSize * 1.6 : 0;
  const seededBidMirror = seedMirror && mirrorReserve1 === 0n ? maxSize * Math.max(0.3, mid) * 1.6 : 0;
  const askMirrorFill = allocateMirrorFill(asks, Number(formatUnits(mirrorReserve0, baseDec)) + seededAskMirror);
  const bidMirrorShares =
    mid > 0 ? (Number(formatUnits(mirrorReserve1, quoteDec)) + seededBidMirror) / Math.max(0.01, mid) : 0;
  const bidMirrorFill = allocateMirrorFill(bids, bidMirrorShares);

  const lo = pv ? Math.min(pv.fromProb, pv.toProb) : 0;
  const hi = pv ? Math.max(pv.fromProb, pv.toProb) : 0;
  const boxLeft = x(lo);
  const boxW = pv ? Math.max(1.2, x(hi) - boxLeft) : 0;
  const boxLabel = pv?.mode === "range" ? "your range" : pv?.mode === "limit" ? "your limit" : "fills here";
  const draggable = !!(pv && pv.mode === "range" && onDragRange);

  const priceAt = (clientX: number) => {
    const r = plotRef.current?.getBoundingClientRect();
    if (!r || r.width === 0) return mid;
    const pct = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
    return axisRef.current.pMin + pct * 2 * axisRef.current.half;
  };
  const onDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!draggable) return;
    e.preventDefault();
    const r = e.currentTarget.getBoundingClientRect();
    const rel = r.width ? (e.clientX - r.left) / r.width : 0.5;
    const part = rel < 0.28 ? "lo" : rel > 0.72 ? "hi" : "move";
    e.currentTarget.setPointerCapture(e.pointerId);
    // freeze a roomy axis (centred on mid) for the whole gesture so the mapping is
    // stable and the box has space to be dragged outward without the axis rescaling
    const fHalf = liveHalf * 1.3;
    frozen.current = { pMin: mid - fHalf, half: fHalf };
    axisRef.current = frozen.current;
    setDragging(true);
    drag.current = { part, startLo: lo, startHi: hi, grab: priceAt(e.clientX) };
  };
  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || !onDragRange) return;
    const clamp = (v: number) => Math.max(0.01, Math.min(0.99, v));
    const p = priceAt(e.clientX);
    let nlo = d.startLo;
    let nhi = d.startHi;
    if (d.part === "lo") nlo = clamp(p);
    else if (d.part === "hi") nhi = clamp(p);
    else {
      const delta = p - d.grab;
      nlo = clamp(d.startLo + delta);
      nhi = clamp(d.startHi + delta);
    }
    if (nlo > nhi) [nlo, nhi] = [nhi, nlo];
    let loCents = Math.round(nlo * 100);
    let hiCents = Math.round(nhi * 100);
    if (loCents >= hiCents) {
      if (d.part === "hi") {
        hiCents = Math.min(99, loCents + 1);
      } else {
        loCents = Math.max(1, hiCents - 1);
      }
    }
    onDragRange(loCents, hiCents);
  };
  const onUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    drag.current = null;
    setDragging(false);
    frozen.current = null; // re-fit the axis to the bars + final box
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  };

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

      <div className="dbx-depth-plot2" ref={plotRef}>
        {empty ? (
          <div className="dbx-depth-empty">No resting liquidity yet — awaiting market makers.</div>
        ) : (
          <>
            {pv && (
              <>
                {/* yellow fill — sits under the bars */}
                <div className={`dbx-range-box ${pv.side}`} style={{ left: `${boxLeft}%`, width: `${boxW}%` }} />
                {/* transparent grab layer — sits above the bars so the box can be dragged */}
                <div
                  className={`dbx-range-grab ${draggable ? "on" : ""}`}
                  style={{ left: `${boxLeft}%`, width: `${boxW}%` }}
                  onPointerDown={draggable ? onDown : undefined}
                  onPointerMove={draggable ? onMove : undefined}
                  onPointerUp={draggable ? onUp : undefined}
                >
                  {draggable && <span className="dbx-box-edge l" />}
                  <span className="dbx-range-box-label">
                    {boxLabel}
                    {draggable ? " ⇆" : ""}
                  </span>
                  {draggable && <span className="dbx-box-edge r" />}
                </div>
              </>
            )}
            <div className="dbx-mid-line" style={{ left: `${x(mid)}%` }} />
            {bids.map((l, i) => (
              <Bar
                key={`b${i}`}
                level={l}
                x={x(l.probability)}
                w={barW}
                h={(l.size / maxSize) * 100}
                mirrorFill={bidMirrorFill[i] ?? 0}
                side="bid"
              />
            ))}
            {asks.map((l, i) => (
              <Bar
                key={`a${i}`}
                level={l}
                x={x(l.probability)}
                w={barW}
                h={(l.size / maxSize) * 100}
                mirrorFill={askMirrorFill[i] ?? 0}
                side="ask"
              />
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

function Bar({
  level,
  x,
  w,
  h,
  mirrorFill,
  side,
}: {
  level: PredictionLevel;
  x: number;
  w: number;
  h: number;
  mirrorFill: number;
  side: "bid" | "ask";
}) {
  return (
    <div
      className={`dbx-bar2 ${side}`}
      title={`${fmtCents(level.probability, 1)} · ${level.size.toLocaleString("en-US", { maximumFractionDigits: 1 })} sh`}
      style={{ left: `${x - w / 2}%`, width: `${w}%`, height: `${Math.max(3, h)}%` }}
    >
      {mirrorFill > 0 && <span className="dbx-bar-mirror" style={{ height: `${Math.max(7, mirrorFill * 100)}%` }} />}
    </div>
  );
}

function fmtUsdShort(n: number): string {
  return `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

function allocateMirrorFill(levels: PredictionLevel[], budget: number): number[] {
  if (!Number.isFinite(budget) || budget <= 0) return levels.map(() => 0);
  let remaining = budget;
  return levels.map((level) => {
    if (remaining <= 0 || level.size <= 0) return 0;
    const used = Math.min(level.size, remaining);
    remaining -= used;
    return used / level.size;
  });
}
