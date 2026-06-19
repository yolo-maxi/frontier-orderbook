import { useEffect, useMemo, useRef, useState } from "react";
import { useApp, type PositionRow } from "../state/app";
import { fmtAmount, fmtNum, fmtPrice, fmtTime, tickToPrice } from "../lib/format";
import { baseDecimals, quoteDecimals } from "../lib/config";
import { ProbabilityPill } from "./ProbabilityPill";
import { formatUnits } from "viem";

export function MarketPanel() {
  const { cfg, summary, priceHistory, fills, makerEvents, market, marketMode, predictionMeta, marketStats, chainStatus } =
    useApp();
  const baseDec = baseDecimals(cfg);
  const quoteDec = quoteDecimals(cfg);
  const [feedTab, setFeedTab] = useState<"trades" | "makers">("trades");
  const isPrediction = marketMode === "prediction";
  const head = chainStatus.head;
  // confirmations of an event's block vs. the chain head; null when unknown
  const confs = (block: bigint): number | null =>
    head !== null && block > 0n && head >= block ? Number(head - block) : null;

  const last = summary ? tickToPrice(summary.currentTick) : null;
  const sessionOpen = priceHistory.length > 0 ? priceHistory[0].price : null;
  const change =
    last !== null && sessionOpen !== null && sessionOpen !== 0
      ? ((last - sessionOpen) / sessionOpen) * 100
      : null;
  const bestAsk = summary?.hasAsk ? tickToPrice(summary.bestAsk) : null;
  const bestBid = summary?.hasBid ? tickToPrice(summary.bestBid) : null;
  const spread = bestAsk !== null && bestBid !== null ? bestAsk - bestBid : null;

  // last-price flash on change
  const prevLast = useRef<number | null>(null);
  const [flash, setFlash] = useState<{ dir: "up" | "down"; key: number } | null>(null);
  useEffect(() => {
    if (last !== null && prevLast.current !== null && last !== prevLast.current) {
      setFlash({ dir: last > prevLast.current ? "up" : "down", key: Date.now() });
    }
    prevLast.current = last;
  }, [last]);

  const trendCls = change === null ? "" : change >= 0 ? "up" : "down";

  const resolveDate =
    isPrediction && predictionMeta
      ? new Date(predictionMeta.resolutionDate + "T00:00:00Z").toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        })
      : null;

  return (
    <section className="center-col">
      {isPrediction && predictionMeta && (
        <div className="panel pred-meta">
          <div className="pred-meta-top">
            <span className="pred-cat">{predictionMeta.category}</span>
            <span className="pred-meta-stats num dim">
              Vol {fmtNum((marketStats?.volume ?? predictionMeta.volume) / 1000, 0)}k {market.quoteSymbol}
              {marketStats && marketStats.volume24h > 0 && (
                <> · 24h {fmtNum(marketStats.volume24h / 1000, 0)}k</>
              )}{" "}
              · Liq {fmtNum((marketStats?.liquidity ?? predictionMeta.liquidity) / 1000, 0)}k
              {marketStats && marketStats.holders > 0 && (
                <> · {fmtNum(marketStats.holders, 0)} holders</>
              )}{" "}
              · resolves {resolveDate}
              {marketStats ? (
                <span className="pred-src pred-src-live" title="Aggregates served by the indexer"> live</span>
              ) : (
                <span className="pred-src" title="Indexer not connected — showing seed figures"> est.</span>
              )}
            </span>
          </div>
          <div className="pred-meta-q-row">
            <h2 className="pred-q">{predictionMeta.question}</h2>
            <ProbabilityPill price={last} size="lg" />
          </div>
          <div className="pred-resolution dim">{predictionMeta.resolution}</div>
        </div>
      )}
      <div className="panel price-head">
        <div className="ph-main">
          <span
            key={flash?.key ?? "static"}
            className={`ph-last num ${trendCls} ${flash ? `flash-${flash.dir}` : ""}`}
          >
            {last !== null ? fmtPrice(last, 3) : "—"}
          </span>
          <span className="ph-sub">{market.priceUnit}</span>
          {isPrediction && <ProbabilityPill price={last} size="sm" />}
        </div>
        <div className="ph-stats num">
          <div className="ph-stat">
            <span className="dim">Session</span>
            <span className={trendCls}>
              {change === null ? "—" : `${change >= 0 ? "+" : ""}${change.toFixed(3)}%`}
            </span>
          </div>
          <div className="ph-stat">
            <span className="dim">Best Bid</span>
            <span className="bid">{bestBid !== null ? fmtPrice(bestBid, 3) : "—"}</span>
          </div>
          <div className="ph-stat">
            <span className="dim">Best Ask</span>
            <span className="ask">{bestAsk !== null ? fmtPrice(bestAsk, 3) : "—"}</span>
          </div>
          <div className="ph-stat">
            <span className="dim">Spread</span>
            <span>{spread !== null ? fmtPrice(spread, 3) : "—"}</span>
          </div>
          <div className="ph-stat">
            <span className="dim">Tick</span>
            <span>{summary ? summary.currentTick.toLocaleString("en-US") : "—"}</span>
          </div>
        </div>
      </div>
      <div className="panel chart-panel">
        <BookChart />
      </div>
      <div className="panel fills-panel">
        <div className="panel-title feed-tabs">
          <button
            className={`feed-tab ${feedTab === "trades" ? "feed-tab-on" : ""}`}
            onClick={() => setFeedTab("trades")}
          >
            Recent Fills
          </button>
          <button
            className={`feed-tab ${feedTab === "makers" ? "feed-tab-on" : ""}`}
            onClick={() => setFeedTab("makers")}
          >
            Maker Activity
          </button>
        </div>
        {feedTab === "trades" ? (
          <>
            <div className="fills-head num grid-trades">
              <span>Time</span>
              <span>Side</span>
              <span className="ta-r">Avg Px</span>
              <span>Price Range</span>
              <span className="ta-r">{market.sizeColumn}</span>
              <span className="ta-r">{market.valueColumn}</span>
              <span className="ta-r">Lvls</span>
            </div>
            <div className="fills-body">
              {fills.length === 0 && (
                <div className="empty-state">
                  no fills observed yet — fills stream in as takers cross the book
                </div>
              )}
              {fills.map((f) => (
                <div className="fill-row num feed-in grid-trades" key={f.key}>
                  <span className="dim fill-time">
                    <FinalityDot confs={confs(f.block)} />
                    {fmtTime(f.time)}
                  </span>
                  <span className={f.side === "buy" ? "up" : "down"}>
                    {f.side === "buy" ? "BUY" : "SELL"}
                  </span>
                  <span className={`ta-r ${f.side === "buy" ? "up" : "down"}`}>
                    {f.size0 > 0n ? fmtPrice(Number(f.value1) / Math.max(Number(f.size0), 1), 3) : "—"}
                  </span>
                  <span>
                    {fmtPrice(f.priceLo, 3)}
                    <span className="dim"> → </span>
                    {fmtPrice(f.priceHi, 3)}
                  </span>
                  <span className="ta-r">{fmtAmount(f.size0, 4, baseDec)}</span>
                  <span className="ta-r">{fmtAmount(f.value1, 2, quoteDec)}</span>
                  <span className="ta-r dim">{f.levels}</span>
                </div>
              ))}
            </div>
          </>
        ) : (
          <>
            <div className="fills-head num grid-makers">
              <span>Time</span>
              <span>Action</span>
              <span className="ta-r">#</span>
              <span>Range</span>
              <span className="ta-r">Size × Lvls</span>
              <span className="ta-r">Total ({market.baseSymbol})</span>
              <span className="ta-r">Payout</span>
            </div>
            <div className="fills-body">
              {makerEvents.length === 0 && (
                <div className="empty-state">
                  no maker activity yet — quotes, requotes, cancels and claims land here
                </div>
              )}
              {makerEvents.map((e) => (
                <div className="fill-row num feed-in grid-makers" key={e.key} title={e.maker ?? undefined}>
                  <span className="dim fill-time">
                    <FinalityDot confs={confs(e.block)} />
                    {fmtTime(e.time)}
                  </span>
                  <span className={makerActionCls(e)}>{makerActionLabel(e)}</span>
                  <span className="ta-r dim">{e.positionId.toString()}</span>
                  <span>
                    {e.priceLo !== null && e.priceHi !== null ? (
                      <>
                        {fmtPrice(e.priceLo, 3)}
                        <span className="dim"> → </span>
                        {fmtPrice(e.priceHi, 3)}
                        {e.maker && (
                          <span className="dim maker-addr"> · {e.maker.slice(0, 6)}…{e.maker.slice(-4)}</span>
                        )}
                      </>
                    ) : (
                      <span className="dim">—</span>
                    )}
                  </span>
                  <span className="ta-r">
                    {e.size0 !== null && e.levels !== null ? (
                      <>
                        {fmtAmount(e.size0, 4, baseDec)} <span className="dim">× {e.levels}</span>
                      </>
                    ) : (
                      <span className="dim">—</span>
                    )}
                  </span>
                  <span className="ta-r">{e.total0 !== null ? fmtAmount(e.total0, 4, baseDec) : <span className="dim">—</span>}</span>
                  <span className="ta-r">
                    {e.payout !== null && (e.payout > 0n || e.refund === null) ? (
                      <span className="up">{fmtAmount(e.payout, 4, baseDec)}</span>
                    ) : null}
                    {e.refund !== null && e.refund > 0n ? (
                      <span className="dim"> +{fmtAmount(e.refund, 4, quoteDec)} rfnd</span>
                    ) : e.payout === null ? (
                      <span className="dim">—</span>
                    ) : null}
                  </span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </section>
  );
}

const AXIS_W = 62;
const GUTTER_W = 150;
const PAD = { t: 14, b: 20, l: 12 };
const BUCKETS = 40;

/** Smooth a polyline with quadratic beziers through segment midpoints. */
function smoothPath(xs: number[], ys: number[]): string {
  const n = xs.length;
  if (n < 2) return "";
  let d = `M${xs[0].toFixed(1)},${ys[0].toFixed(1)}`;
  for (let i = 1; i < n - 1; i++) {
    const xc = (xs[i] + xs[i + 1]) / 2;
    const yc = (ys[i] + ys[i + 1]) / 2;
    d += `Q${xs[i].toFixed(1)},${ys[i].toFixed(1)} ${xc.toFixed(1)},${yc.toFixed(1)}`;
  }
  d += `L${xs[n - 1].toFixed(1)},${ys[n - 1].toFixed(1)}`;
  return d;
}

const toF = (v: bigint, decimals = 18) => Number(v) / 10 ** decimals;

/** Total principal of a (possibly shaped) ladder, in token0 float. */
function ladderTotal(liquidity: bigint, slope: bigint, n: number, baseDec: number): number {
  const nb = BigInt(n);
  return toF(liquidity * nb + (slope * nb * (nb - 1n)) / 2n, baseDec);
}

interface Band {
  key: string;
  side: "ask" | "bid";
  pLo: number;
  pHi: number;
  fillFrac: number; // 0..1 consumed
  label: string;
}

function positionBands(positions: PositionRow[], baseDec: number): Band[] {
  return positions
    .filter((p) => p.live)
    .slice(0, 8)
    .map((p) => {
      const n = p.upper - p.lower;
      const total = ladderTotal(p.liquidity, p.slope, n, baseDec);
      const unfilled = toF(p.unfilled, baseDec);
      const frac = total > 0 ? Math.min(1, Math.max(0, 1 - unfilled / total)) : 0;
      return {
        key: p.id.toString() + (p.isBid ? "b" : "a"),
        side: p.isBid ? ("bid" as const) : ("ask" as const),
        pLo: tickToPrice(p.lower),
        pHi: tickToPrice(p.upper),
        fillFrac: frac,
        label: `${p.isBid ? "BID" : "ASK"} ${(frac * 100).toFixed(0)}% filled`,
      };
    });
}

/**
 * The book, on the chart. One shared price axis carries:
 *  - the price history line (main area)
 *  - the live depth profile (right gutter: asks red, bids green)
 *  - your open positions as side-tinted bands, hatched up to their fill frontier
 *  - the ladder you are configuring in Make, as a gold band + size profile
 *  - the execution range of a live Trade quote, as a bracket to its end price
 */
function BookChart() {
  const { cfg, priceHistory, depth, summary, positions, preview, makeFocus, copyFocus, shadow } = useApp();
  const baseDec = baseDecimals(cfg);
  const quoteDec = quoteDecimals(cfg);
  const shadowR0 = Number(formatUnits(shadow.reserve0, baseDec));
  const shadowR1 = Number(formatUnits(shadow.reserve1, quoteDec));
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(760);
  // Make mode: the BOOK's share of the chart expands — the price line
  // compresses to the left and the depth bars take ~45% of the width, so
  // the maker view is about the book, not the line. Same canvas size; the
  // divider eases leftward over ~450ms rather than snapping.
  const H = 280;
  const targetGut = makeFocus ? Math.min(Math.round(width * 0.45), 430) : GUTTER_W;
  const [GUT, setGut] = useState(targetGut);
  const gutRef = useRef(targetGut);
  useEffect(() => {
    const from = gutRef.current;
    const to = targetGut;
    if (from === to) return;
    const t0 = performance.now();
    const dur = 450;
    let raf = 0;
    const stepFn = (t: number) => {
      const k = Math.min(1, (t - t0) / dur);
      const ease = 1 - Math.pow(1 - k, 3);
      const v = Math.round(from + (to - from) * ease);
      gutRef.current = v;
      setGut(v);
      if (k < 1) raf = requestAnimationFrame(stepFn);
    };
    raf = requestAnimationFrame(stepFn);
    return () => cancelAnimationFrame(raf);
  }, [targetGut]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w && w > 40) setWidth(Math.round(w));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const model = useMemo(() => {
    if (priceHistory.length < 2 || !summary) return null;
    const W = width;
    const plotX1 = W - AXIS_W - GUT;
    const gutX0 = plotX1 + 6;
    const gutX1 = W - AXIS_W - 4;

    // ----- price (Y) domain: history ∪ near book ∪ any preview band
    const pts = priceHistory;
    let min = Infinity;
    let max = -Infinity;
    for (const p of pts) {
      if (p.price < min) min = p.price;
      if (p.price > max) max = p.price;
    }
    const mid = tickToPrice(summary.currentTick);
    if (summary.hasAsk) max = Math.max(max, tickToPrice(summary.bestAsk) + mid * 0.0004);
    if (summary.hasBid) min = Math.min(min, tickToPrice(summary.bestBid) - mid * 0.0004);
    if (preview?.kind === "make" && preview.lowerTick !== undefined && preview.upperTick !== undefined) {
      min = Math.min(min, tickToPrice(preview.lowerTick));
      max = Math.max(max, tickToPrice(preview.upperTick));
    }
    if (preview?.kind === "trade" && preview.endTick !== undefined) {
      min = Math.min(min, tickToPrice(preview.endTick));
      max = Math.max(max, tickToPrice(preview.endTick));
    }
    // your open positions are ALWAYS in view: the Y domain stretches to
    // cover every band (a far ladder compresses the price line — that is
    // the correct trade: you can't manage what you can't see)
    const allBands = positionBands(positions, baseDec);
    for (const b of allBands) {
      min = Math.min(min, b.pLo);
      max = Math.max(max, b.pHi);
    }
    const pad = Math.max((max - min) * 0.1, mid * 0.0003);
    min -= pad;
    max += pad;

    const sy = (p: number) => PAD.t + (1 - (p - min) / (max - min)) * (H - PAD.t - PAD.b);

    // ----- price line
    const x0 = pts[0].t;
    const xr = Math.max(pts[pts.length - 1].t - x0, 1);
    const sx = (t: number) => PAD.l + ((t - x0) / xr) * (plotX1 - PAD.l - 6);
    const xs = pts.map((p) => sx(p.t));
    const ys = pts.map((p) => sy(p.price));
    const d = smoothPath(xs, ys);
    const lastPt = pts[pts.length - 1];
    const area = d + `L${xs[xs.length - 1].toFixed(1)},${H - PAD.b}L${xs[0].toFixed(1)},${H - PAD.b}Z`;
    const up = lastPt.price >= pts[0].price;

    // ----- depth → price buckets for the gutter
    const bh = (H - PAD.t - PAD.b) / BUCKETS;
    const askB = new Array<number>(BUCKETS).fill(0);
    const bidB = new Array<number>(BUCKETS).fill(0);
    const bucketPx = new Array<number>(BUCKETS).fill(0).map((_, i) => max - ((i + 0.5) / BUCKETS) * (max - min));
    for (const lv of depth) {
      const price = tickToPrice(lv.tick);
      if (price < min || price >= max) continue;
      const bi = Math.min(BUCKETS - 1, Math.max(0, Math.floor(((max - price) / (max - min)) * BUCKETS)));
      askB[bi] += toF(lv.askSize, baseDec);
      bidB[bi] += toF(lv.bidSize, baseDec);
    }
    const copyBuckets = (active: number[], side: "ask" | "bid", reserve0: number, reserve1: number) => {
      const out = new Array<number>(BUCKETS).fill(0);
      let budget = side === "ask" ? reserve0 : reserve1;
      const indices = [...active.keys()].sort((a, b) => (side === "ask" ? b - a : a - b));
      for (const i of indices) {
        const v = active[i];
        if (v <= 0 || budget <= 0) continue;
        if (side === "ask") {
          const copy = Math.min(v, budget);
          out[i] = copy;
          budget -= copy;
        } else {
          const px = Math.max(bucketPx[i], 1e-12);
          const cost = v * px;
          const copy = budget >= cost ? v : v * (budget / cost);
          out[i] = copy;
          budget -= Math.min(cost, budget);
        }
      }
      return { buckets: out, offBook: Math.max(0, budget) };
    };
    const askCopy = copyBuckets(askB, "ask", shadowR0, shadowR1);
    const bidCopy = copyBuckets(bidB, "bid", shadowR0, shadowR1);

    // ----- make-preview ladder → same buckets (comparable scale)
    const prevB = new Array<number>(BUCKETS).fill(0);
    if (
      preview?.kind === "make" &&
      preview.lowerTick !== undefined &&
      preview.upperTick !== undefined &&
      preview.sizePerLevel !== undefined
    ) {
      const L0 = toF(preview.sizePerLevel, baseDec);
      const slope = toF(preview.slope ?? 0n, baseDec);
      const nLv = preview.upperTick - preview.lowerTick;
      const step = Math.max(1, Math.floor(nLv / 400)); // sample big ladders
      for (let k = 0; k < nLv; k += step) {
        const price = tickToPrice(preview.lowerTick + k);
        if (price < min || price >= max) continue;
        const bi = Math.min(BUCKETS - 1, Math.max(0, Math.floor(((max - price) / (max - min)) * BUCKETS)));
        prevB[bi] += (L0 + slope * k) * step;
      }
    }
    const maxBucket = Math.max(...askB, ...bidB, ...prevB, 1e-12);
    const gw = gutX1 - gutX0;
    const barW = (v: number) => Math.min(gw, (v / maxBucket) * gw);

    // ----- make-preview, per LEVEL: bucket sums flatten a narrow ladder
    // into a blob; rendering each level (width = local density in bucket
    // units, so it stays comparable to the book bars) makes the ladder's
    // SHAPE visible — a flat ladder is a rectangle, a front-loaded one a
    // wedge tapering away from the touch
    const prevLevels: { y: number; h: number; w: number }[] = [];
    if (
      preview?.kind === "make" &&
      preview.lowerTick !== undefined &&
      preview.upperTick !== undefined &&
      preview.sizePerLevel !== undefined
    ) {
      const L0 = toF(preview.sizePerLevel, baseDec);
      const slope = toF(preview.slope ?? 0n, baseDec);
      const nLv = preview.upperTick - preview.lowerTick;
      const step = Math.max(1, Math.ceil(nLv / 120));
      const bucketSpan = (max - min) / BUCKETS;
      for (let k = 0; k < nLv; k += step) {
        const pA = tickToPrice(preview.lowerTick + k);
        const pB = tickToPrice(preview.lowerTick + Math.min(k + step, nLv));
        if (pB < min || pA >= max) continue;
        const yTop = sy(pB);
        const yBot = sy(pA);
        const levelSpan = Math.max(pB - pA, 1e-9);
        const density = ((L0 + slope * k) * step * bucketSpan) / levelSpan;
        prevLevels.push({ y: yTop, h: Math.max(1, yBot - yTop), w: barW(density) });
      }
    }

    // ----- overlays
    const bands = allBands.filter((b) => b.pHi > min && b.pLo < max);
    const offAbove = allBands.filter((b) => b.pLo >= max);
    const offBelow = allBands.filter((b) => b.pHi <= min);
    const grid: { y: number; label: string }[] = [];
    for (let i = 0; i <= 3; i++) {
      const p = min + ((max - min) * i) / 3;
      grid.push({ y: sy(p), label: fmtPrice(p, 2) });
    }

    return {
      W, plotX1, gutX0, gutX1, min, max, sy,
      d, area, up,
      lastX: xs[xs.length - 1], lastY: sy(lastPt.price), lastPrice: lastPt.price,
      askB, bidB, askCopyB: askCopy.buckets, bidCopyB: bidCopy.buckets,
      askCopyOffBook: askCopy.offBook, bidCopyOffBook: bidCopy.offBook,
      prevB, prevLevels, bh, barW,
      bands, offAbove, offBelow, grid, mid,
      midY: sy(mid),
    };
  }, [priceHistory, depth, summary, positions, preview, width, GUT, H, baseDec, quoteDec, shadowR0, shadowR1]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!model) {
    return (
      <div className="chart-wrap" ref={wrapRef}>
        <div className="empty-state chart-empty">collecting price history…</div>
      </div>
    );
  }

  const m = model;
  const stroke = m.up ? "#2ebd85" : "#f6465d";
  const clampY = (y: number) => Math.max(PAD.t, Math.min(H - PAD.b, y));

  return (
    <div className="chart-wrap" ref={wrapRef}>
      <svg viewBox={`0 0 ${m.W} ${H}`} className="chart" style={{ height: H }}>
        <defs>
          <linearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={stroke} stopOpacity="0.14" />
            <stop offset="55%" stopColor={stroke} stopOpacity="0.04" />
            <stop offset="100%" stopColor={stroke} stopOpacity="0" />
          </linearGradient>
          <pattern id="hatchAsk" width="6" height="6" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
            <line x1="0" y1="0" x2="0" y2="6" stroke="#f6465d" strokeOpacity="0.35" strokeWidth="1.4" />
          </pattern>
          <pattern id="hatchBid" width="6" height="6" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
            <line x1="0" y1="0" x2="0" y2="6" stroke="#2ebd85" strokeOpacity="0.35" strokeWidth="1.4" />
          </pattern>
        </defs>

        {m.grid.map((g, i) => (
          <g key={i}>
            <line x1={PAD.l} x2={m.gutX1} y1={g.y} y2={g.y} className="chart-grid" />
            <text x={m.W - AXIS_W + 8} y={g.y + 3} className="chart-axis">{g.label}</text>
          </g>
        ))}

        {/* ---- my open positions: side-tinted bands, hatched to the fill frontier */}
        {m.bands.map((b) => {
          const yTop = clampY(m.sy(b.pHi));
          const yBot = clampY(m.sy(b.pLo));
          const frontier = b.side === "ask" ? b.pLo + (b.pHi - b.pLo) * b.fillFrac : b.pHi - (b.pHi - b.pLo) * b.fillFrac;
          const yF = clampY(m.sy(frontier));
          const col = b.side === "ask" ? "#f6465d" : "#2ebd85";
          return (
            <g key={b.key}>
              <rect x={PAD.l} y={yTop} width={m.plotX1 - PAD.l} height={Math.max(2, yBot - yTop)} fill={col} fillOpacity="0.07" />
              <line x1={PAD.l} x2={m.plotX1} y1={yTop} y2={yTop} stroke={col} strokeOpacity="0.4" strokeWidth="1" />
              <line x1={PAD.l} x2={m.plotX1} y1={yBot} y2={yBot} stroke={col} strokeOpacity="0.4" strokeWidth="1" />
              {b.fillFrac > 0.005 && (
                <rect
                  x={PAD.l}
                  y={b.side === "ask" ? yF : yTop}
                  width={m.plotX1 - PAD.l}
                  height={Math.max(1, b.side === "ask" ? yBot - yF : yF - yTop)}
                  fill={b.side === "ask" ? "url(#hatchAsk)" : "url(#hatchBid)"}
                />
              )}
              <text x={PAD.l + 6} y={yTop + 11} className="chart-band-label" fill={col}>{b.label}</text>
            </g>
          );
        })}

        {/* ---- off-screen position signposts */}
        {m.offAbove.length > 0 && (
          <g>
            <rect x={PAD.l + 4} y={PAD.t + 2} width={170} height={15} rx={4} className="chart-offchip" />
            <text x={PAD.l + 11} y={PAD.t + 13} className="chart-band-label" fill="#aab0bb">
              ▲ {m.offAbove.length} position{m.offAbove.length > 1 ? "s" : ""} above · {fmtPrice(m.offAbove[0].pLo, 2)}+
            </text>
          </g>
        )}
        {m.offBelow.length > 0 && (
          <g>
            <rect x={PAD.l + 4} y={H - PAD.b - 17} width={170} height={15} rx={4} className="chart-offchip" />
            <text x={PAD.l + 11} y={H - PAD.b - 6} className="chart-band-label" fill="#aab0bb">
              ▼ {m.offBelow.length} position{m.offBelow.length > 1 ? "s" : ""} below · ≤{fmtPrice(m.offBelow[0].pHi, 2)}
            </text>
          </g>
        )}

        {/* ---- make-tab preview: gold band + its size profile in the gutter */}
        {preview?.kind === "make" && preview.lowerTick !== undefined && preview.upperTick !== undefined && (
          <g>
            <rect
              x={PAD.l}
              y={clampY(m.sy(tickToPrice(preview.upperTick)))}
              width={m.plotX1 - PAD.l}
              height={Math.max(2, clampY(m.sy(tickToPrice(preview.lowerTick))) - clampY(m.sy(tickToPrice(preview.upperTick))))}
              className="chart-preview-band"
            />
            <text
              x={PAD.l + 6}
              y={clampY(m.sy(tickToPrice(preview.upperTick))) - 4}
              className="chart-band-label"
              fill="#f0b90b"
            >
              NEW {preview.side.toUpperCase()} LADDER
            </text>
            {m.prevLevels.map((lv, i) => (
              <rect
                key={i}
                x={m.gutX1 - lv.w}
                y={lv.y}
                width={lv.w}
                height={lv.h}
                fill="#f0b90b"
                fillOpacity="0.26"
                stroke="#f0b90b"
                strokeOpacity="0.6"
                strokeWidth="0.5"
              />
            ))}
            {/* range edge markers across the gutter */}
            <line x1={m.gutX0} x2={m.gutX1} y1={clampY(m.sy(tickToPrice(preview.upperTick)))} y2={clampY(m.sy(tickToPrice(preview.upperTick)))} stroke="#f0b90b" strokeOpacity="0.8" strokeWidth="1" strokeDasharray="2 2" />
            <line x1={m.gutX0} x2={m.gutX1} y1={clampY(m.sy(tickToPrice(preview.lowerTick)))} y2={clampY(m.sy(tickToPrice(preview.lowerTick)))} stroke="#f0b90b" strokeOpacity="0.8" strokeWidth="1" strokeDasharray="2 2" />
          </g>
        )}

        {/* ---- price line */}
        <path d={m.area} fill="url(#chartFill)" />
        <path d={m.d} fill="none" stroke={stroke} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
        <line x1={PAD.l} x2={m.gutX1} y1={m.lastY} y2={m.lastY} className="chart-last-line" stroke={stroke} />
        <circle cx={m.lastX} cy={m.lastY} r="2.6" fill={stroke} />
        <circle cx={m.lastX} cy={m.lastY} r="6" fill={stroke} opacity="0.18" />

        {/* ---- live depth profile (the book, on the chart) */}
        <line x1={m.gutX0 - 1} x2={m.gutX0 - 1} y1={PAD.t} y2={H - PAD.b} className="chart-gutter-divider" />
        {m.askB.map((v, i) => {
          const activeW = m.barW(v);
          const copyW = Math.min(activeW, m.barW(m.askCopyB[i]));
          const y = PAD.t + i * m.bh + 0.5;
          const h = Math.max(1, m.bh - 1);
          return v > 0 ? (
            <g key={`a${i}`}>
              {v > 0 && <rect x={m.gutX1 - activeW} y={y} width={activeW} height={h} fill="#f6465d" fillOpacity="0.34" />}
              {copyFocus && copyW > 0 && <rect x={m.gutX1 - activeW} y={y} width={copyW} height={h} className="chart-copy-sheen" />}
            </g>
          ) : null;
        })}
        {m.bidB.map((v, i) => {
          const activeW = m.barW(v);
          const copyW = Math.min(activeW, m.barW(m.bidCopyB[i]));
          const y = PAD.t + i * m.bh + 0.5;
          const h = Math.max(1, m.bh - 1);
          return v > 0 ? (
            <g key={`b${i}`}>
              {v > 0 && <rect x={m.gutX1 - activeW} y={y} width={activeW} height={h} fill="#2ebd85" fillOpacity="0.34" />}
              {copyFocus && copyW > 0 && <rect x={m.gutX1 - activeW} y={y} width={copyW} height={h} className="chart-copy-sheen" />}
            </g>
          ) : null;
        })}
        {copyFocus && (m.askCopyOffBook > 0.0005 || m.bidCopyOffBook > 0.5) && (
          <g>
            <rect x={m.gutX0 + 4} y={PAD.t + 4} width={m.gutX1 - m.gutX0 - 8} height={16} rx={4} className="chart-offchip" />
            <text x={m.gutX0 + 10} y={PAD.t + 16} className="chart-band-label" fill="#f0b90b">
              OFF-BOOK COPY
            </text>
          </g>
        )}

        {/* ---- trade quote: bracket from here to the projected end price */}
        {preview?.kind === "trade" && preview.endTick !== undefined && (
          (() => {
            const yEnd = clampY(m.sy(tickToPrice(preview.endTick)));
            const col = preview.side === "ask" ? "#2ebd85" : "#f6465d"; // buy walks up, sell walks down
            const xB = m.gutX0 - 10;
            return (
              <g className="chart-bracket">
                <line x1={xB} x2={xB} y1={m.lastY} y2={yEnd} stroke={col} strokeWidth="1.6" strokeDasharray="3 3" />
                <line x1={xB - 5} x2={xB + 5} y1={m.lastY} y2={m.lastY} stroke={col} strokeWidth="1.6" />
                <line x1={xB - 5} x2={xB + 5} y1={yEnd} y2={yEnd} stroke={col} strokeWidth="1.6" />
                <circle cx={xB} cy={yEnd} r="2.6" fill={col} />
                <text x={xB - 8} y={yEnd + (yEnd < m.lastY ? -6 : 12)} textAnchor="end" className="chart-band-label" fill={col}>
                  fills → {fmtPrice(tickToPrice(preview.endTick), 3)}
                </text>
              </g>
            );
          })()
        )}

        {/* ---- last price pill on the axis */}
        <g>
          <rect x={m.W - AXIS_W + 3} y={m.lastY - 9} width={AXIS_W - 6} height={18} rx={5} fill={stroke} />
          <text x={m.W - AXIS_W + (AXIS_W - 6) / 2 + 3} y={m.lastY + 3.5} textAnchor="middle" className="chart-last-label">
            {fmtPrice(m.lastPrice, 2)}
          </text>
        </g>
      </svg>
    </div>
  );
}

/**
 * MM (loop 2) — per-event finality dot. Confirmations of the event's block vs.
 * the chain head: <2 = pending (amber pulse), 2..11 = confirming, 12+ = final.
 */
function FinalityDot({ confs }: { confs: number | null }) {
  if (confs === null) {
    return <i className="fin-dot fin-unknown" title="confirmations unknown" />;
  }
  const cls = confs < 2 ? "fin-pending" : confs < 12 ? "fin-confirming" : "fin-final";
  const label =
    confs < 2 ? "just landed" : confs < 12 ? `${confs} confirmations` : "final (12+ confs)";
  return <i className={`fin-dot ${cls}`} title={label} />;
}

function makerActionLabel(e: { kind: string; side: "ask" | "bid" | null }): string {
  const side = e.side ? ` ${e.side.toUpperCase()}` : "";
  switch (e.kind) {
    case "place":
      return `PLACE${side}`;
    case "requote":
      return `REQUOTE${side}`;
    case "cancel":
      return "CANCEL";
    default:
      return "CLAIM";
  }
}

function makerActionCls(e: { kind: string; side: "ask" | "bid" | null }): string {
  if (e.kind === "place" || e.kind === "requote") {
    return e.side === "ask" ? "down" : e.side === "bid" ? "up" : "dim";
  }
  return e.kind === "claim" ? "up" : "dim";
}
