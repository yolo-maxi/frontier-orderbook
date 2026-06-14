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
  return px > 0 && px < 1.2 ? clampProb(px) : null;
}

function bookFromSide(
  outcome: Outcome,
  summary: BookSummary | null,
  depth: DepthLevel[],
  baseDecimals: number,
): PredictionBook {
  const bestBid = summary?.hasBid ? clampProb(tickToPrice(summary.bestBid)) : null;
  const bestAsk = summary?.hasAsk ? clampProb(tickToPrice(summary.bestAsk)) : null;
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
  if (noSummary) {
    return [yes, bookFromSide("NO", noSummary, noDepth, baseDecimals)];
  }
  // synthetic complement fallback
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
    bidDepth: invertDepth(yes.askDepth, "bid"),
    askDepth: invertDepth(yes.bidDepth, "ask"),
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

function makeDepth(depth: DepthLevel[], side: "ask" | "bid", baseDecimals: number): PredictionLevel[] {
  const rows = depth
    .map((d) => {
      const raw = side === "ask" ? d.askSize : d.bidSize;
      return {
        probability: clampProb(tickToPrice(d.tick)),
        tick: d.tick,
        size: Number(formatUnits(raw, baseDecimals)),
      };
    })
    .filter((d) => d.size > 0)
    .sort((a, b) => (side === "ask" ? a.probability - b.probability : b.probability - a.probability));
  let cum = 0;
  return rows.slice(0, 14).map((r) => {
    cum += r.size;
    return { ...r, cum };
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
