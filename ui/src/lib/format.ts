import { formatUnits, parseUnits } from "viem";

/**
 * Price model — GEOMETRIC book: price (token1 per token0) = 1.0001 ** tick.
 *
 * The DarkBox prediction books are GeometricFrontierBook instances. Verified
 * on-chain: yesBook.rateAt(200000) === round(1.0001**200000 * 1e18). For a
 * binary outcome token that redeems to 1 sUSDC, this price IS the implied
 * probability (valid in (0,1), i.e. tick < 0). The legacy linear model
 * (1 + 0.001*tick) belonged to the old WETH/USDC spot demo and is wrong here.
 */
export const TICK_BASE = 1.0001;
const LN_BASE = Math.log(TICK_BASE);

export function tickToPrice(tick: number): number {
  return Math.pow(TICK_BASE, tick);
}

export function priceToTick(price: number): number {
  if (!(price > 0)) return 0;
  return Math.round(Math.log(price) / LN_BASE);
}

/** Round a tick to the nearest multiple of spacing (down, or up when up=true). */
export function alignTick(tick: number, spacing: number, up: boolean): number {
  const q = Math.floor(tick / spacing);
  const lo = q * spacing;
  if (lo === tick) return tick;
  return up ? lo + spacing : lo;
}

/** Clamp a probability into the open unit interval the book can represent. */
export function clampProb(p: number): number {
  return Math.max(0.001, Math.min(0.999, p));
}

export function fmtPrice(p: number, dp = 2): string {
  if (!Number.isFinite(p)) return "—";
  return p.toLocaleString("en-US", {
    minimumFractionDigits: dp,
    maximumFractionDigits: dp,
  });
}

/** Format a token bigint amount with explicit decimals (no 18-decimal assumption). */
export function fmtAmount(x: bigint, dp = 4, decimals = 6): string {
  const s = formatUnits(x, decimals);
  const n = Number(s);
  if (!Number.isFinite(n)) return s;
  if (n !== 0 && Math.abs(n) < 10 ** -dp) return `<${(10 ** -dp).toFixed(dp)}`;
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: dp,
  });
}

/** Compact USD-ish notional, e.g. $20.4M / $12.3k / $945. */
export function fmtUsd(n: number, dp = 2): string {
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(abs >= 10_000_000 ? 1 : 2)}M`;
  if (abs >= 1_000) return `$${(n / 1_000).toFixed(abs >= 100_000 ? 0 : 1)}k`;
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: dp === 0 ? 0 : 2, maximumFractionDigits: 2 })}`;
}

export function fmtNum(n: number, dp = 4): string {
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: dp,
  });
}

export function parseAmount(s: string, decimals = 6): bigint | null {
  const t = s.trim();
  if (!t || !/^\d*\.?\d*$/.test(t) || t === ".") return null;
  try {
    return parseUnits(t, decimals);
  } catch {
    return null;
  }
}

export function shortAddr(a: string): string {
  return a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}

export function fmtTime(tsMs: number): string {
  return new Date(tsMs).toLocaleTimeString("en-US", { hour12: false });
}

/** "x time ago" for the activity feed. */
export function fmtAgo(tsMs: number, nowMs: number): string {
  const s = Math.max(0, Math.round((nowMs - tsMs) / 1000));
  if (s < 5) return "now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/** Pick a "nice" step >= raw from the 1/2/5 ladder (min 0.001). */
export function niceStep(raw: number): number {
  if (!Number.isFinite(raw) || raw <= 0.001) return 0.001;
  const mag = 10 ** Math.floor(Math.log10(raw));
  for (const m of [1, 2, 5, 10]) {
    if (mag * m >= raw) return mag * m;
  }
  return mag * 10;
}

export function stepDecimals(step: number): number {
  if (step >= 1) return 2;
  if (step >= 0.01) return 2;
  return 3;
}
