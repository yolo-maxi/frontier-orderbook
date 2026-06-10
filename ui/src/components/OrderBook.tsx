import { useMemo } from "react";
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
  const { summary, depth } = useApp();

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
    const prices = [...asks, ...bids].map((x) => x.price);
    const span =
      prices.length > 1 ? Math.max(...prices) - Math.min(...prices) : 0;
    const step = niceStep(span / (BUCKETS_PER_SIDE * 1.6));
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
    return { askBuckets, bidBuckets, maxCum, mid, spread, dp };
  }, [summary, depth]);

  if (!model) {
    return (
      <section className="panel book-panel">
        <div className="panel-title">Order Book</div>
        <div className="empty-state">loading depth…</div>
      </section>
    );
  }

  const { askBuckets, bidBuckets, maxCum, mid, spread, dp } = model;
  const sizeDp = 3;

  return (
    <section className="panel book-panel">
      <div className="panel-title">
        Order Book <span className="dim title-note">bucket {fmtPrice(niceish(askBuckets, bidBuckets), 3)}</span>
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
            <div className="book-row" key={`a${b.price}`}>
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
          <span className="book-mid-px">{fmtPrice(mid, 3)}</span>
          <span className="dim">
            {spread !== null ? `spread ${fmtPrice(spread, 3)} (${fmtPrice((spread / mid) * 10000, 1)} bps)` : "one-sided"}
          </span>
        </div>
        <div className="book-side book-bids">
          {bidBuckets.length === 0 && <div className="empty-state">no bids in window</div>}
          {bidBuckets.map((b) => (
            <div className="book-row" key={`b${b.price}`}>
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

function fmtSize(n: number, dp: number): string {
  if (n >= 1000) return n.toLocaleString("en-US", { maximumFractionDigits: 1 });
  return n.toLocaleString("en-US", {
    minimumFractionDigits: dp,
    maximumFractionDigits: dp,
  });
}

function niceish(a: Bucket[], b: Bucket[]): number {
  const all = [...a, ...b];
  if (all.length < 2) return 0.001;
  const ps = all.map((x) => x.price).sort((x, y) => x - y);
  let min = Infinity;
  for (let i = 1; i < ps.length; i++) min = Math.min(min, ps[i] - ps[i - 1]);
  return Number.isFinite(min) ? min : 0.001;
}
