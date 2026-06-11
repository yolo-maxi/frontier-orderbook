import { useEffect, useMemo, useReducer, useRef } from "react";
import { useApp } from "../state/app";
import { fmtPrice, niceStep, stepDecimals, tickToPrice } from "../lib/format";
import { formatUnits } from "viem";

interface Bucket {
  price: number; // bucket lower edge price
  size: number; // token0 units (float, display only)
  cum: number;
}

const BUCKETS_PER_SIDE = 25;

function bucketize(
  entries: { price: number; size: number }[],
  step: number,
  side: "ask" | "bid",
): Bucket[] {
  const map = new Map<number, number>();
  for (const e of entries) {
    const k = Math.floor(e.price / step + 1e-9) * step;
    map.set(k, (map.get(k) ?? 0) + e.size);
  }
  // asks: ascending price (closest to mid first); bids: descending
  const keys = [...map.keys()].sort((a, b) => (side === "ask" ? a - b : b - a));
  const out: Bucket[] = [];
  let cum = 0;
  for (const k of keys.slice(0, BUCKETS_PER_SIDE)) {
    const size = map.get(k)!;
    cum += size;
    out.push({ price: k, size, cum });
  }
  return out;
}

export function OrderBook() {
  const { summary, depth, preview } = useApp();
  // price range of the ladder being configured in Make (if any)
  const previewRange =
    preview?.kind === "make" && preview.lowerTick !== undefined && preview.upperTick !== undefined
      ? {
          side: preview.side,
          pLo: tickToPrice(preview.lowerTick),
          pHi: tickToPrice(preview.upperTick),
        }
      : null;
  const inPreview = (side: "ask" | "bid", bucketLo: number, step: number) =>
    previewRange !== null &&
    previewRange.side === side &&
    bucketLo + step > previewRange.pLo &&
    bucketLo < previewRange.pHi;
  const midDirRef = useRef<{ prev: number | null; dir: 1 | -1 | 0 }>({ prev: null, dir: 0 });
  const stepRef = useRef<number | null>(null);
  // rows that vanished keep fading for a beat; rows that changed flash
  const ghostsRef = useRef<{ ask: Map<number, Ghost>; bid: Map<number, Ghost> }>({
    ask: new Map(),
    bid: new Map(),
  });
  const flashesRef = useRef<{ ask: Map<number, CellFlash>; bid: Map<number, CellFlash> }>({
    ask: new Map(),
    bid: new Map(),
  });
  const prevBucketsRef = useRef<{ ask: Map<number, number>; bid: Map<number, number>; step: number } | null>(null);
  const [, bump] = useReducer((x: number) => x + 1, 0);

  const model = useMemo(() => {
    if (!summary) return null;
    const asks: { price: number; size: number }[] = [];
    const bids: { price: number; size: number }[] = [];
    for (const l of depth) {
      if (l.askSize > 0n) {
        asks.push({ price: tickToPrice(l.tick), size: Number(formatUnits(l.askSize, 18)) });
      }
      if (l.bidSize > 0n) {
        bids.push({ price: tickToPrice(l.tick), size: Number(formatUnits(l.bidSize, 18)) });
      }
    }
    const sideSpan = (xs: { price: number }[]) =>
      xs.length > 1
        ? Math.max(...xs.map((x) => x.price)) - Math.min(...xs.map((x) => x.price))
        : 0;
    const span = Math.max(sideSpan(asks), sideSpan(bids));
    // hysteresis: niceStep flaps between adjacent 1-2-5 levels as the span
    // drifts, re-bucketing the whole book in one frame ("everything
    // disappeared"). Keep the previous step until the raw one is decisively
    // (>2.5x) away.
    let step = niceStep(span / BUCKETS_PER_SIDE);
    const prevStep = stepRef.current;
    if (prevStep !== null && step !== prevStep && step > prevStep / 2.5 && step < prevStep * 2.5) {
      step = prevStep;
    }
    stepRef.current = step;
    const dp = stepDecimals(step);
    const askBuckets = bucketize(asks, step, "ask");
    const bidBuckets = bucketize(bids, step, "bid");
    const maxCum = Math.max(
      askBuckets.length ? askBuckets[askBuckets.length - 1].cum : 0,
      bidBuckets.length ? bidBuckets[bidBuckets.length - 1].cum : 0,
      1e-12,
    );
    const mid =
      summary.hasAsk && summary.hasBid
        ? (tickToPrice(summary.bestAsk) + tickToPrice(summary.bestBid)) / 2
        : tickToPrice(summary.currentTick);
    const spread =
      summary.hasAsk && summary.hasBid
        ? tickToPrice(summary.bestAsk) - tickToPrice(summary.bestBid)
        : null;
    return { askBuckets, bidBuckets, maxCum, mid, spread, dp, step };
  }, [summary, depth]);

  useEffect(() => {
    if (!model) return;
    const now = Date.now();
    const cur = {
      ask: new Map(model.askBuckets.map((b) => [b.price, b.size])),
      bid: new Map(model.bidBuckets.map((b) => [b.price, b.size])),
    };
    const prev = prevBucketsRef.current;
    if (prev && prev.step === model.step) {
      for (const side of ["ask", "bid"] as const) {
        for (const [price, size] of prev[side]) {
          if (!cur[side].has(price)) ghostsRef.current[side].set(price, { price, size, ts: now });
        }
        for (const [price, size] of cur[side]) {
          ghostsRef.current[side].delete(price);
          const old = prev[side].get(price);
          if (old !== undefined && Math.abs(size - old) > Math.abs(old) * 1e-4) {
            flashesRef.current[side].set(price, { dir: size > old ? "up" : "down", ts: now });
          }
        }
      }
    } else {
      // bucket grid changed wholesale: ghosts would be misleading
      ghostsRef.current.ask.clear();
      ghostsRef.current.bid.clear();
    }
    prevBucketsRef.current = { ...cur, step: model.step };
    bump();
    const t = setTimeout(() => {
      const cutoff = Date.now() - GHOST_MS;
      for (const side of ["ask", "bid"] as const) {
        for (const [k, g] of ghostsRef.current[side]) if (g.ts < cutoff) ghostsRef.current[side].delete(k);
        for (const [k, f] of flashesRef.current[side]) if (f.ts < cutoff) flashesRef.current[side].delete(k);
      }
      bump();
    }, GHOST_MS + 60);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model]);

  if (!model) {
    return (
      <section className="panel book-panel">
        <div className="panel-title">Order Book</div>
        <div className="book-head num">
          <span>Price (USDC)</span>
          <span>Size (WETH)</span>
          <span>Total</span>
        </div>
        <div className="book-body">
          <div className="book-side book-asks">
            {SKELETON_WIDTHS.map((w, i) => (
              <SkeletonRow key={`sa${i}`} w={w} />
            ))}
          </div>
          <div className="skel-mid">
            <span className="skel" />
          </div>
          <div className="book-side book-bids">
            {SKELETON_WIDTHS.map((_, i) => (
              <SkeletonRow key={`sb${i}`} w={SKELETON_WIDTHS[SKELETON_WIDTHS.length - 1 - i]} />
            ))}
          </div>
        </div>
      </section>
    );
  }

  const { askBuckets, bidBuckets, maxCum, mid, spread, dp, step } = model;
  const sizeDp = 3;

  // mid-price direction (vs. previous non-equal mid) for the spread divider arrow
  const tracker = midDirRef.current;
  if (tracker.prev !== null && mid !== tracker.prev) {
    tracker.dir = mid > tracker.prev ? 1 : -1;
  }
  tracker.prev = mid;
  const midDir = tracker.dir;

  return (
    <section className="panel book-panel">
      <div className="panel-title">
        Order Book <span className="dim title-note">bucket ${fmtPrice(step, 3)}</span>
        {previewRange && (
          <span className="book-preview-chip num">
            your {previewRange.side} ladder {fmtPrice(previewRange.pLo, 3)}–{fmtPrice(previewRange.pHi, 3)}
          </span>
        )}
      </div>
      <div className="book-head num">
        <span>Price (USDC)</span>
        <span>Size (WETH)</span>
        <span>Total</span>
      </div>
      <div className="book-body">
        <div className="book-side book-asks">
          {askBuckets.length === 0 && <div className="empty-state">no asks in window</div>}
          {mergeGhosts(askBuckets, ghostsRef.current.ask, "ask").map((b) =>
            b.ghost ? (
              <div className="book-row book-row-ghost" key={`ga${b.price}`}>
                <span className="px num">{fmtPrice(b.price, dp)}</span>
                <span className="num">{fmtSize(b.size, sizeDp)}</span>
                <span className="num dim">—</span>
              </div>
            ) : (
              <div className={`book-row ${inPreview("ask", b.price, step) ? "book-row-hl" : ""}`} key={`a${b.price}`}>
                {flashOverlay(flashesRef.current.ask.get(b.price))}
                <div
                  className="book-bar bar-ask"
                  style={{ width: `${Math.min(100, (b.cum / maxCum) * 100)}%` }}
                />
                <span className="px ask num">{fmtPrice(b.price, dp)}</span>
                <span className="num">{fmtSize(b.size, sizeDp)}</span>
                <span className="num dim">{fmtSize(b.cum, sizeDp)}</span>
              </div>
            ),
          )}
        </div>
        <div className="book-mid num">
          <span
            className={`book-mid-px ${midDir === 1 ? "up" : midDir === -1 ? "down" : ""}`}
          >
            {fmtPrice(mid, 3)}
            {midDir !== 0 && (
              <span className="book-mid-arrow">{midDir === 1 ? "▲" : "▼"}</span>
            )}
          </span>
          <span className="book-mid-spread">
            {spread !== null
              ? `spread ${fmtPrice(spread, 3)} · ${fmtPrice((spread / mid) * 10000, 2)} bps`
              : "one-sided book"}
          </span>
        </div>
        <div className="book-side book-bids">
          {bidBuckets.length === 0 && <div className="empty-state">no bids in window</div>}
          {mergeGhosts(bidBuckets, ghostsRef.current.bid, "bid").map((b) =>
            b.ghost ? (
              <div className="book-row book-row-ghost" key={`gb${b.price}`}>
                <span className="px num">{fmtPrice(b.price, dp)}</span>
                <span className="num">{fmtSize(b.size, sizeDp)}</span>
                <span className="num dim">—</span>
              </div>
            ) : (
              <div className={`book-row ${inPreview("bid", b.price, step) ? "book-row-hl" : ""}`} key={`b${b.price}`}>
                {flashOverlay(flashesRef.current.bid.get(b.price))}
                <div
                  className="book-bar bar-bid"
                  style={{ width: `${Math.min(100, (b.cum / maxCum) * 100)}%` }}
                />
                <span className="px bid num">{fmtPrice(b.price, dp)}</span>
                <span className="num">{fmtSize(b.size, sizeDp)}</span>
                <span className="num dim">{fmtSize(b.cum, sizeDp)}</span>
              </div>
            ),
          )}
        </div>
      </div>
    </section>
  );
}

const SKELETON_WIDTHS = [72, 64, 58, 52, 46, 42, 38, 34, 30, 26, 22, 18];

function SkeletonRow({ w }: { w: number }) {
  return (
    <div className="skel-row">
      <span className="skel" style={{ width: "64%" }} />
      <span className="skel" style={{ width: `${w}%` }} />
      <span className="skel" style={{ width: `${Math.min(96, w + 18)}%` }} />
    </div>
  );
}

function fmtSize(n: number, dp: number): string {
  if (n >= 1000) return n.toLocaleString("en-US", { maximumFractionDigits: 1 });
  return n.toLocaleString("en-US", {
    minimumFractionDigits: dp,
    maximumFractionDigits: dp,
  });
}

const GHOST_MS = 700;

interface Ghost {
  price: number;
  size: number;
  ts: number;
}

interface CellFlash {
  dir: "up" | "down";
  ts: number;
}

type RowItem = (Bucket & { ghost: false }) | { price: number; size: number; cum: number; ghost: true };

function mergeGhosts(buckets: Bucket[], ghosts: Map<number, Ghost>, side: "ask" | "bid"): RowItem[] {
  const now = Date.now();
  const live: RowItem[] = buckets.map((b) => ({ ...b, ghost: false as const }));
  for (const g of ghosts.values()) {
    if (now - g.ts >= GHOST_MS) continue;
    live.push({ price: g.price, size: g.size, cum: 0, ghost: true as const });
  }
  live.sort((a, b) => (side === "ask" ? a.price - b.price : b.price - a.price));
  // asks render reversed (highest at the top of the ask stack)
  return side === "ask" ? live.reverse() : live;
}

function flashOverlay(f: CellFlash | undefined) {
  if (!f || Date.now() - f.ts >= GHOST_MS) return null;
  return <span className={`cell-flash ${f.dir}`} key={f.ts} />;
}
