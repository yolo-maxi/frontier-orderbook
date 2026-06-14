import { formatUnits } from "viem";
import type { BookSummary, DepthLevel, PositionRow } from "../state/app";
import { tickToPrice } from "./format";

export type Outcome = "YES" | "NO";

export interface PredictionLevel {
  probability: number;
  size: number;
  cum: number;
}

export interface PredictionBook {
  outcome: Outcome;
  source: "live" | "synthetic";
  bestBid: number | null;
  bestAsk: number | null;
  mid: number;
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

const STRIKE_PRICE = 2000;
const VOL_SCALE = 325;

export function probabilityFromPrice(price: number): number {
  if (!Number.isFinite(price)) return 0.5;
  const z = Math.max(-8, Math.min(8, (price - STRIKE_PRICE) / VOL_SCALE));
  return clamp01(1 / (1 + Math.exp(-z)));
}

export function probabilityFromTick(tick: number): number {
  return probabilityFromPrice(tickToPrice(tick));
}

export function fmtProb(p: number | null, dp = 1): string {
  if (p === null || !Number.isFinite(p)) return "-";
  return `${(p * 100).toFixed(dp)}c`;
}

export function fmtPct(p: number | null, dp = 1): string {
  if (p === null || !Number.isFinite(p)) return "-";
  return `${(p * 100).toFixed(dp)}%`;
}

export function buildPredictionBooks(summary: BookSummary | null, depth: DepthLevel[], baseDecimals = 18): [PredictionBook, PredictionBook] {
  const mid = summary ? probabilityFromTick(summary.currentTick) : 0.5;
  const yesBid = summary?.hasBid ? probabilityFromTick(summary.bestBid) : null;
  const yesAsk = summary?.hasAsk ? probabilityFromTick(summary.bestAsk) : null;
  const yesBook: PredictionBook = {
    outcome: "YES",
    source: "live",
    bestBid: yesBid,
    bestAsk: yesAsk,
    mid,
    spread: yesBid !== null && yesAsk !== null ? Math.max(0, yesAsk - yesBid) : null,
    bidDepth: makeDepth(depth, "bid", mid, baseDecimals),
    askDepth: makeDepth(depth, "ask", mid, baseDecimals),
  };
  const noBid = yesAsk === null ? null : clamp01(1 - yesAsk);
  const noAsk = yesBid === null ? null : clamp01(1 - yesBid);
  const noBook: PredictionBook = {
    outcome: "NO",
    source: "synthetic",
    bestBid: noBid,
    bestAsk: noAsk,
    mid: clamp01(1 - mid),
    spread: noBid !== null && noAsk !== null ? Math.max(0, noAsk - noBid) : null,
    bidDepth: invertDepth(yesBook.askDepth, "bid"),
    askDepth: invertDepth(yesBook.bidDepth, "ask"),
  };
  return [yesBook, noBook];
}

export function complementSignal(yes: PredictionBook, no: PredictionBook): ComplementSignal {
  const yesAskNoAsk = yes.bestAsk !== null && no.bestAsk !== null ? yes.bestAsk + no.bestAsk : null;
  const yesBidNoBid = yes.bestBid !== null && no.bestBid !== null ? yes.bestBid + no.bestBid : null;
  const askOverround = yesAskNoAsk === null ? null : yesAskNoAsk - 1;
  const bidUnderround = yesBidNoBid === null ? null : 1 - yesBidNoBid;
  let hint = "Waiting for both touches.";
  if (askOverround !== null && bidUnderround !== null) {
    if (askOverround < -0.002) hint = "Buy both outcomes is priced below $1.00.";
    else if (bidUnderround < -0.002) hint = "Sell both outcomes is bid above $1.00.";
    else hint = "Complement is internally balanced.";
  }
  return { yesAskNoAsk, yesBidNoBid, askOverround, bidUnderround, hint };
}

export function exposureFromPositions(positions: PositionRow[], baseDecimals = 18) {
  const live = positions.filter((p) => p.live);
  const yesResting = live.reduce((acc, p) => acc + Number(formatUnits(p.unfilled, baseDecimals)), 0);
  const yesClaimable = live.reduce((acc, p) => acc + Number(formatUnits(p.claimable, baseDecimals)), 0);
  return {
    liveOrders: live.length,
    yesResting,
    yesClaimable,
    maxLoss: yesResting,
    maxPayout: yesClaimable + yesResting,
  };
}

function makeDepth(depth: DepthLevel[], side: "ask" | "bid", mid: number, baseDecimals: number): PredictionLevel[] {
  const rows = depth
    .map((d) => {
      const raw = side === "ask" ? d.askSize : d.bidSize;
      return { probability: probabilityFromTick(d.tick), size: Number(formatUnits(raw, baseDecimals)) };
    })
    .filter((d) => d.size > 0)
    .sort((a, b) => (side === "ask" ? a.probability - b.probability : b.probability - a.probability));
  const source = rows.length > 0 ? rows : indicativeDepth(side, mid);
  let cum = 0;
  return source.slice(0, 16).map((r) => {
    cum += r.size;
    return { ...r, cum };
  });
}

function indicativeDepth(side: "ask" | "bid", mid: number) {
  return Array.from({ length: 10 }, (_, i) => {
    const offset = (i + 1) * 0.008;
    return {
      probability: clamp01(side === "ask" ? mid + offset : mid - offset),
      size: 5 + i * 1.75,
    };
  });
}

function invertDepth(levels: PredictionLevel[], side: "ask" | "bid"): PredictionLevel[] {
  let cum = 0;
  return levels
    .map((l) => ({ probability: clamp01(1 - l.probability), size: l.size }))
    .sort((a, b) => (side === "ask" ? a.probability - b.probability : b.probability - a.probability))
    .map((l) => {
      cum += l.size;
      return { ...l, cum };
    });
}

function clamp01(x: number): number {
  return Math.max(0.001, Math.min(0.999, x));
}
