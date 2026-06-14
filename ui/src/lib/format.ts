import { formatUnits, parseUnits } from "viem";

/**
 * Geometric Frontier price model: price = 1.0001^tick.
 * Tick ~82,947 is about $4,000.
 */
const GEOM_BASE = 1.0001;
const LOG_GEOM_BASE = Math.log(GEOM_BASE);

export function tickToPrice(tick: number): number {
  return GEOM_BASE ** tick;
}

export function priceToTick(price: number): number {
  return Math.round(Math.log(price) / LOG_GEOM_BASE);
}

/** Round a tick down to the nearest multiple of spacing (toward -inf). */
export function alignTick(tick: number, spacing: number, up: boolean): number {
  const q = Math.floor(tick / spacing);
  const lo = q * spacing;
  if (lo === tick) return tick;
  return up ? lo + spacing : lo;
}

export function fmtPrice(p: number, dp = 2): string {
  if (!Number.isFinite(p)) return "—";
  return p.toLocaleString("en-US", {
    minimumFractionDigits: dp,
    maximumFractionDigits: dp,
  });
}

/** Format a token bigint amount. */
export function fmtAmount(x: bigint, dp = 4, decimals = 18): string {
  const s = formatUnits(x, decimals);
  const n = Number(s);
  if (!Number.isFinite(n)) return s;
  if (n !== 0 && Math.abs(n) < 10 ** -dp) return `<${(10 ** -dp).toFixed(dp)}`;
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: dp,
  });
}

export function fmtNum(n: number, dp = 4): string {
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: dp,
  });
}

export function parseAmount(s: string, decimals = 18): bigint | null {
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

/** Pick a "nice" price step >= raw from the 1/2/5 ladder (min 0.001). */
export function niceStep(raw: number): number {
  if (!Number.isFinite(raw) || raw <= 0.001) return 0.001;
  const mag = 10 ** Math.floor(Math.log10(raw));
  for (const m of [1, 2, 5, 10]) {
    if (mag * m >= raw) return mag * m;
  }
  return mag * 10;
}

/** Decimal places appropriate for a given price step. */
export function stepDecimals(step: number): number {
  if (step >= 1) return 2;
  if (step >= 0.01) return 2;
  return 3;
}


export function amountToInput(x: bigint, decimals = 18): string {
  return formatUnits(x, decimals);
}
