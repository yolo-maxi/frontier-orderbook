import { useMemo, useRef } from "react";
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
    const step = niceStep(span / BUCKETS_PER_SIDE);
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
          {[...askBuckets].reverse().map((b) => (
            <div className={`book-row ${inPreview("ask", b.price, step) ? "book-row-hl" : ""}`} key={`a${b.price}`}>
              <div
                className="book-bar bar-ask"
                style={{ width: `${Math.min(100, (b.cum / maxCum) * 100)}%` }}
              />
              <span className="px ask num">{fmtPrice(b.price, dp)}</span>
              <span className="num">{fmtSize(b.size, sizeDp)}</span>
              <span className="num dim">{fmtSize(b.cum, sizeDp)}</span>
            </div>
          ))}
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
          {bidBuckets.map((b) => (
            <div className={`book-row ${inPreview("bid", b.price, step) ? "book-row-hl" : ""}`} key={`b${b.price}`}>
              <div
                className="book-bar bar-bid"
                style={{ width: `${Math.min(100, (b.cum / maxCum) * 100)}%` }}
              />
              <span className="px bid num">{fmtPrice(b.price, dp)}</span>
              <span className="num">{fmtSize(b.size, sizeDp)}</span>
              <span className="num dim">{fmtSize(b.cum, sizeDp)}</span>
            </div>
          ))}
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
