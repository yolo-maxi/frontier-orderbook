import { formatUnits } from "viem";
import type { BookSummary, DepthLevel, PositionRow } from "../state/app";
import { clampProb, tickToPrice } from "./format";

export type Outcome = "YES" | "NO";

export interface PredictionLevel {
  probability: number;
  tick: number;
  size: number;
  cum: number;
}

export interface PredictionBook {
  outcome: Outcome;
  source: "live" | "synthetic";
  /** True when the book has at least one resting order on either side. */
  hasMarket: boolean;
  bestBid: number | null;
  bestAsk: number | null;
  /** Primary displayed probability: touch midpoint, else last trade. null when no market. */
  prob: number | null;
  /** Last traded probability (from currentTick), null when out of the (0,1) band. */
  last: number | null;
  spread: number | null;
  bidDepth: PredictionLevel[];
  askDepth: PredictionLevel[];
}

/** The order the user is currently composing, projected onto the depth view. */
export interface OrderPreview {
  outcome: Outcome;
  mode: "market" | "limit";
  side: "buy" | "sell";
  fromProb: number; // touch / start price
  toProb: number; // sweep end (market) or rest price (limit)
  avgProb: number; // avg fill (market) or rest price (limit)
  shares: number;
  cost: number; // sUSDC
}

export interface ComplementSignal {
  yesAskNoAsk: number | null;
  yesBidNoBid: number | null;
  askOverround: number | null;
  bidUnderround: number | null;
  hint: string;
}

/** Probability as integer-cent string, Polymarket-style: 0.27 -> "27¢". */
export function fmtCents(p: number | null, dp = 0): string {
  if (p === null || !Number.isFinite(p)) return "—";
  return `${(p * 100).toFixed(dp)}¢`;
}

/** Probability as percent: 0.27 -> "27%". */
export function fmtPct(p: number | null, dp = 0): string {
  if (p === null || !Number.isFinite(p)) return "—";
  return `${(p * 100).toFixed(dp)}%`;
}

/** Legacy alias kept for any callers expecting cents. */
export const fmtProb = fmtCents;

/** A currentTick price only counts as a "last trade" when it lands inside the
 * representable probability band — the empty-book construction tick (200000 ≈
 * price 4.85e8) must NOT be shown as a 99.9% probability. */
function lastFromTick(currentTick: number): number | null {
  const px = tickToPrice(currentTick);
  return inBand(px) ? clampProb(px) : null;
}

/** A binary-outcome price must lie in (0,1). Touches/levels outside this band
 * are junk (e.g. orphaned asks resting at the book's construction tick, where
 * price ≈ 4.85e8) and must never surface as a 99.9¢ quote. */
const inBand = (px: number): boolean => px > 0.002 && px < 1;

function bookFromSide(
  outcome: Outcome,
  summary: BookSummary | null,
  depth: DepthLevel[],
  baseDecimals: number,
): PredictionBook {
  const askPx = summary?.hasAsk ? tickToPrice(summary.bestAsk) : null;
  const bidPx = summary?.hasBid ? tickToPrice(summary.bestBid) : null;
  const bestAsk = askPx !== null && inBand(askPx) ? clampProb(askPx) : null;
  const bestBid = bidPx !== null && inBand(bidPx) ? clampProb(bidPx) : null;
  const last = summary ? lastFromTick(summary.currentTick) : null;
  const mid =
    bestBid !== null && bestAsk !== null
      ? (bestBid + bestAsk) / 2
      : bestBid ?? bestAsk ?? null;
  const hasMarket = bestBid !== null || bestAsk !== null;
  return {
    outcome,
    source: "live",
    hasMarket,
    bestBid,
    bestAsk,
    prob: mid ?? last,
    last,
    spread: bestBid !== null && bestAsk !== null ? Math.max(0, bestAsk - bestBid) : null,
    bidDepth: makeDepth(depth, "bid", baseDecimals),
    askDepth: makeDepth(depth, "ask", baseDecimals),
  };
}

/**
 * Build YES and NO prediction books. When a live NO book summary/depth is
 * supplied (noBook is deployed) both are real; otherwise NO is derived as the
 * 1 − YES complement and flagged synthetic.
 */
export function buildPredictionBooks(
  yesSummary: BookSummary | null,
  yesDepth: DepthLevel[],
  noSummary: BookSummary | null,
  noDepth: DepthLevel[],
  baseDecimals = 6,
): [PredictionBook, PredictionBook] {
  const yes = bookFromSide("YES", yesSummary, yesDepth, baseDecimals);
  const live = noSummary ? bookFromSide("NO", noSummary, noDepth, baseDecimals) : null;
  // Use the live NO book when it has a usable in-band market; otherwise (no NO
  // book, or its frontier is parked out of band) derive NO ≈ 1 − YES so the UI
  // always shows a sensible complementary price and the two sum to ~100¢.
  if (live && live.prob !== null) {
    return [yes, live];
  }
  const noBid = yes.bestAsk === null ? null : clampProb(1 - yes.bestAsk);
  const noAsk = yes.bestBid === null ? null : clampProb(1 - yes.bestBid);
  const noMid = yes.prob === null ? null : clampProb(1 - yes.prob);
  const no: PredictionBook = {
    outcome: "NO",
    source: "synthetic",
    hasMarket: yes.hasMarket,
    bestBid: noBid,
    bestAsk: noAsk,
    prob: noMid,
    last: yes.last === null ? null : clampProb(1 - yes.last),
    spread: noBid !== null && noAsk !== null ? Math.max(0, noAsk - noBid) : null,
    bidDepth: live && live.bidDepth.length ? live.bidDepth : invertDepth(yes.askDepth, "bid"),
    askDepth: live && live.askDepth.length ? live.askDepth : invertDepth(yes.bidDepth, "ask"),
  };
  return [yes, no];
}

export function complementSignal(yes: PredictionBook, no: PredictionBook): ComplementSignal {
  const yesAskNoAsk = yes.bestAsk !== null && no.bestAsk !== null ? yes.bestAsk + no.bestAsk : null;
  const yesBidNoBid = yes.bestBid !== null && no.bestBid !== null ? yes.bestBid + no.bestBid : null;
  const askOverround = yesAskNoAsk === null ? null : yesAskNoAsk - 1;
  const bidUnderround = yesBidNoBid === null ? null : 1 - yesBidNoBid;
  let hint = "Waiting for both touches.";
  if (askOverround !== null && bidUnderround !== null) {
    if (askOverround < -0.002) hint = "Buying both sides costs under $1.00 — mint-and-sell edge.";
    else if (bidUnderround < -0.002) hint = "Selling both sides bids over $1.00 — split-and-sell edge.";
    else hint = "Complement is internally balanced.";
  }
  return { yesAskNoAsk, yesBidNoBid, askOverround, bidUnderround, hint };
}

export function exposureFromPositions(positions: PositionRow[], baseDecimals = 6) {
  const live = positions.filter((p) => p.live);
  const resting = live.reduce((acc, p) => acc + Number(formatUnits(p.unfilled, baseDecimals)), 0);
  const claimable = live.reduce((acc, p) => acc + Number(formatUnits(p.claimable, baseDecimals)), 0);
  return {
    liveOrders: live.length,
    yesResting: resting,
    yesClaimable: claimable,
    maxLoss: resting,
    maxPayout: claimable + resting,
  };
}

const BUCKET_TICKS = 25; // ~0.25¢ per depth bucket
const MAX_BUCKETS = 13;

/** Aggregate the per-tick ladder into price buckets, nearest-touch first, so the
 * depth view spans a meaningful range (~3¢/side) instead of 14 adjacent ticks. */
function makeDepth(depth: DepthLevel[], side: "ask" | "bid", baseDecimals: number): PredictionLevel[] {
  const raw = depth
    .map((d) => ({
      tick: d.tick,
      px: tickToPrice(d.tick),
      size: Number(formatUnits(side === "ask" ? d.askSize : d.bidSize, baseDecimals)),
    }))
    .filter((d) => d.size > 0 && inBand(d.px))
    .sort((a, b) => (side === "ask" ? a.tick - b.tick : b.tick - a.tick)); // nearest touch first
  if (raw.length === 0) return [];
  const startTick = raw[0].tick;
  const buckets = new Map<number, { size: number; tick: number }>();
  for (const r of raw) {
    const idx = Math.floor(Math.abs(r.tick - startTick) / BUCKET_TICKS);
    if (idx >= MAX_BUCKETS) break;
    const b = buckets.get(idx);
    if (b) b.size += r.size;
    else buckets.set(idx, { size: r.size, tick: r.tick });
  }
  let cum = 0;
  return [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, b]) => {
      cum += b.size;
      return { probability: clampProb(tickToPrice(b.tick)), tick: b.tick, size: b.size, cum };
    });
}

function invertDepth(levels: PredictionLevel[], side: "ask" | "bid"): PredictionLevel[] {
  let cum = 0;
  return levels
    .map((l) => ({ probability: clampProb(1 - l.probability), tick: -l.tick, size: l.size }))
    .sort((a, b) => (side === "ask" ? a.probability - b.probability : b.probability - a.probability))
    .map((l) => {
      cum += l.size;
      return { ...l, cum };
    });
}
