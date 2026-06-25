import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { formatUnits } from "viem";
import { baseDecimals, quoteDecimals } from "../../lib/config";
import { alignTick, priceToTick, tickToPrice } from "../../lib/format";
import { fmtCents, fmtPct, type Outcome, type OrderPreview, type PredictionBook, type PredictionLevel } from "../../lib/prediction";
import { useApp } from "../../state/app";

type MirrorLiquidityDepth = {
  reserve0: bigint;
  reserve1: bigint;
};

type DepthAxis = {
  pMin: number;
  half: number;
};

/**
 * Liquidity depth view — bars on an explicit price axis (mid centred, bids green
 * left / asks red right, height = resting size). The order you're composing is a
 * YELLOW BOX over the exact price region it occupies, under the bars. When it's a
 * range order the box is DRAGGABLE: grab a side edge to resize the band, the
 * middle to slide it, or the top edge to change the order size.
 */
const MIN_RANGE_BOX_WIDTH = 1.2;
const RANGE_SIZE_SCALE_FLOOR_SHARES = 500;
const RANGE_SIZE_MIN_SHARES = 1;

export function DepthBars({
  outcome,
  onOutcome,
  yes,
  no,
  mirrorLiquidity,
  preview,
  onDragRange,
  onDragSize,
}: {
  outcome: Outcome;
  onOutcome: (o: Outcome) => void;
  yes: PredictionBook;
  no: PredictionBook;
  mirrorLiquidity?: MirrorLiquidityDepth | null;
  preview?: OrderPreview | null;
  onDragRange?: (loCents: number, hiCents: number) => void;
  onDragSize?: (shares: number) => void;
}) {
  const { cfg } = useApp();
  const baseDec = baseDecimals(cfg);
  const quoteDec = quoteDecimals(cfg);
  const seedMirror = new URLSearchParams(window.location.search).get("seedMirror") === "1";
  const mirrorReserve0 = mirrorLiquidity?.reserve0 ?? 0n;
  const mirrorReserve1 = mirrorLiquidity?.reserve1 ?? 0n;
  const book = outcome === "YES" ? yes : no;
  const tickSpacing = book.tickSpacing;
  const bids = book.bidDepth;
  const asks = book.askDepth;
  const all = [...bids, ...asks];
  const empty = all.length === 0;
  const mid = book.prob ?? 0.5;
  const pv = preview && preview.outcome === outcome ? preview : null;

  // ── drag the range box ──────────────────────────────────────────────
  const [dragging, setDragging] = useState(false);
  const [frozenAxis, setFrozenAxis] = useState<DepthAxis | null>(null);
  const plotRef = useRef<HTMLDivElement>(null);
  const axisRef = useRef({ pMin: 0, half: 1 });
  const frozen = useRef<DepthAxis | null>(null);
  const drag = useRef<null | {
    part: "lo" | "hi" | "move" | "size";
    startLo: number;
    startHi: number;
    grab: number;
  }>(null);

  // The price axis fits resting liquidity only. Once real book data arrives,
  // freeze that axis so polling updates can change bar heights without moving
  // the scale underneath the user's pointer.
  const liveAxis = computeDepthAxis(mid, all);
  const hasAxisData = book.prob !== null || all.length > 0;
  useEffect(() => {
    setFrozenAxis(null);
    frozen.current = null;
  }, [outcome]);
  useEffect(() => {
    if (hasAxisData && frozenAxis === null) setFrozenAxis(liveAxis);
  }, [hasAxisData, frozenAxis, liveAxis.half, liveAxis.pMin]);
  const displayAxis = frozenAxis ?? liveAxis;
  const drifted = frozenAxis !== null && hasDepthDrift(frozenAxis, liveAxis, mid, all);
  const half = dragging && frozen.current ? frozen.current.half : displayAxis.half;
  const pMin = dragging && frozen.current ? frozen.current.pMin : displayAxis.pMin;
  const pMax = pMin + 2 * half;
  const xRaw = (p: number) => ((p - pMin) / (2 * half)) * 100;
  const x = (p: number) => Math.max(0, Math.min(100, xRaw(p)));
  const axisMid = pMin + half;
  axisRef.current = { pMin, half };
  const maxSize = Math.max(1, ...all.map((l) => l.size));
  // A full-height range box represents this many shares. It scales with visible
  // book depth but never below 500 sh, matching the ticket's largest quick preset.
  const rangeSizeMax = Math.max(RANGE_SIZE_SCALE_FLOOR_SHARES, maxSize * 2);
  const barW = Math.max(1.6, Math.min(4.5, 64 / Math.max(8, all.length)));
  const seededAskMirror = seedMirror && mirrorReserve0 === 0n ? maxSize * 1.6 : 0;
  const seededBidMirror = seedMirror && mirrorReserve1 === 0n ? maxSize * Math.max(0.3, mid) * 1.6 : 0;
  const askMirrorFill = allocateMirrorFill(asks, Number(formatUnits(mirrorReserve0, baseDec)) + seededAskMirror);
  const bidMirrorShares =
    mid > 0 ? (Number(formatUnits(mirrorReserve1, quoteDec)) + seededBidMirror) / Math.max(0.01, mid) : 0;
  const bidMirrorFill = allocateMirrorFill(bids, bidMirrorShares);

  const lo = pv ? Math.min(pv.fromProb, pv.toProb) : 0;
  const hi = pv ? Math.max(pv.fromProb, pv.toProb) : 0;
  const boxRawLeft = pv ? Math.min(xRaw(lo), xRaw(hi)) : 0;
  const boxRawRight = pv ? Math.max(xRaw(lo), xRaw(hi)) : 0;
  const boxOffLeft = pv ? boxRawRight <= 0 : false;
  const boxOffRight = pv ? boxRawLeft >= 100 : false;
  const boxVisibleLeft = Math.max(0, Math.min(100, boxRawLeft));
  const boxVisibleRight = Math.max(0, Math.min(100, boxRawRight));
  const boxLeft = !pv ? 0 : boxOffRight ? 100 - MIN_RANGE_BOX_WIDTH : boxVisibleLeft;
  const boxW = !pv
    ? 0
    : Math.max(MIN_RANGE_BOX_WIDTH, boxOffLeft || boxOffRight ? MIN_RANGE_BOX_WIDTH : boxVisibleRight - boxVisibleLeft);
  const boxHeight = pv?.mode === "range" ? Math.max(6, Math.min(100, (pv.shares / rangeSizeMax) * 100)) : 100;
  const boxExtendsLeft = pv ? lo < pMin : false;
  const boxExtendsRight = pv ? hi > pMax : false;
  const boxLabel = pv?.mode === "range" ? "your range" : pv?.mode === "limit" ? "your limit" : "fills here";
  const showBoxLabel = pv?.mode !== "range" || boxHeight >= 14;
  const horizontalDraggable = !!(pv && pv.mode === "range" && onDragRange);
  const sizeDraggable = !!(pv && pv.mode === "range" && onDragSize);
  const draggable = horizontalDraggable || sizeDraggable;

  const priceAt = (clientX: number) => {
    const r = plotRef.current?.getBoundingClientRect();
    if (!r || r.width === 0) return mid;
    const pct = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
    return axisRef.current.pMin + pct * 2 * axisRef.current.half;
  };
  const tickBounds = () => ({
    min: alignTick(priceToTick(0.01), tickSpacing, true),
    max: alignTick(priceToTick(0.99), tickSpacing, false),
  });
  const snapTick = (probability: number, up: boolean) => {
    const { min, max } = tickBounds();
    const clamped = Math.max(0.01, Math.min(0.99, probability));
    return Math.max(min, Math.min(max, alignTick(priceToTick(clamped), tickSpacing, up)));
  };
  const tickToCents = (tick: number) => Number((tickToPrice(tick) * 100).toFixed(4));
  const sizeAt = (clientY: number) => {
    const r = plotRef.current?.getBoundingClientRect();
    if (!r || r.height === 0) return pv?.shares ?? RANGE_SIZE_MIN_SHARES;
    const pct = Math.max(0, Math.min(1, 1 - (clientY - r.top) / r.height));
    return Math.max(RANGE_SIZE_MIN_SHARES, rangeSizeMax * pct);
  };
  const onDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!draggable) return;
    e.preventDefault();
    const r = e.currentTarget.getBoundingClientRect();
    const rel = r.width ? (e.clientX - r.left) / r.width : 0.5;
    const relY = r.height ? (e.clientY - r.top) / r.height : 0.5;
    const target = e.target instanceof HTMLElement ? e.target : null;
    const topGrab = sizeDraggable && (relY < 0.24 || target?.classList.contains("dbx-range-top-handle"));
    const part = topGrab ? "size" : rel < 0.28 ? "lo" : rel > 0.72 ? "hi" : "move";
    if (part === "size" && !onDragSize) return;
    if (part !== "size" && !onDragRange) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    // Freeze the current bar-derived axis for the whole gesture so the mapping is
    // stable even while the preview range/size changes.
    frozen.current = { pMin, half };
    axisRef.current = frozen.current;
    setDragging(true);
    drag.current = { part, startLo: lo, startHi: hi, grab: priceAt(e.clientX) };
    if (part === "size") onDragSize?.(sizeAt(e.clientY));
  };
  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    if (d.part === "size") {
      onDragSize?.(sizeAt(e.clientY));
      return;
    }
    if (!onDragRange) return;
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
    let loTick = snapTick(nlo, false);
    let hiTick = snapTick(nhi, true);
    if (loTick > hiTick) [loTick, hiTick] = [hiTick, loTick];
    if (loTick >= hiTick) {
      const { min, max } = tickBounds();
      if (d.part === "hi") {
        hiTick = Math.min(max, loTick + tickSpacing);
      } else {
        loTick = Math.max(min, hiTick - tickSpacing);
      }
      if (loTick >= hiTick) loTick = Math.max(min, hiTick - tickSpacing);
    }
    onDragRange(tickToCents(loTick), tickToCents(hiTick));
  };
  const onUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    drag.current = null;
    setDragging(false);
    frozen.current = null; // re-fit the axis to resting bars
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
        {drifted && (
          <button
            className="dbx-depth-refresh"
            type="button"
            onClick={() => {
              setFrozenAxis(liveAxis);
              frozen.current = null;
              axisRef.current = liveAxis;
            }}
          >
            Recenter
          </button>
        )}
      </div>

      <div className="dbx-depth-plot2" ref={plotRef}>
        {empty ? (
          <div className="dbx-depth-empty">No resting liquidity yet — awaiting market makers.</div>
        ) : (
          <>
            {pv && (
              <>
                {/* yellow fill — sits under the bars */}
                <div
                  className={`dbx-range-box ${pv.side} ${boxExtendsLeft ? "extends-left" : ""} ${boxExtendsRight ? "extends-right" : ""}`}
                  style={{ left: `${boxLeft}%`, width: `${boxW}%`, height: `${boxHeight}%` }}
                />
                {/* transparent grab layer — sits above the bars so the box can be dragged */}
                <div
                  className={`dbx-range-grab ${draggable ? "on" : ""} ${boxExtendsLeft ? "extends-left" : ""} ${boxExtendsRight ? "extends-right" : ""}`}
                  style={{ left: `${boxLeft}%`, width: `${boxW}%`, height: `${boxHeight}%` }}
                  onPointerDown={draggable ? onDown : undefined}
                  onPointerMove={draggable ? onMove : undefined}
                  onPointerUp={draggable ? onUp : undefined}
                  onPointerCancel={draggable ? onUp : undefined}
                >
                  {sizeDraggable && <span className="dbx-range-top-handle dbx-box-edge t" />}
                  {horizontalDraggable && <span className="dbx-box-edge l" />}
                  {showBoxLabel && (
                    <span className="dbx-range-box-label">
                      {boxLabel}
                      {horizontalDraggable ? " ⇆" : ""}
                    </span>
                  )}
                  {horizontalDraggable && <span className="dbx-box-edge r" />}
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
        <span className="dbx-axis-mid">{fmtCents(axisMid, 0)}</span>
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

function computeDepthAxis(mid: number, levels: PredictionLevel[]): DepthAxis {
  const liquiditySpans = levels.map((l) => Math.abs(l.probability - mid));
  const half = Math.max(0.006, ...liquiditySpans) * 1.16;
  return { pMin: mid - half, half };
}

function hasDepthDrift(frozen: DepthAxis, live: DepthAxis, mid: number, levels: PredictionLevel[]): boolean {
  const axisWidth = 2 * frozen.half;
  if (!(axisWidth > 0)) return false;
  const pct = (p: number) => ((p - frozen.pMin) / axisWidth) * 100;
  const midPct = pct(mid);
  if (midPct < 20 || midPct > 80) return true;
  if (levels.some((l) => {
    const x = pct(l.probability);
    return x <= 2 || x >= 98;
  })) {
    return true;
  }
  const liveCenter = live.pMin + live.half;
  const frozenCenter = frozen.pMin + frozen.half;
  return Math.abs(liveCenter - frozenCenter) / axisWidth > 0.2 || live.half > frozen.half * 1.25;
}
