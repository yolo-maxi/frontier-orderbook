import { useMemo } from "react";

/**
 * Compact probability sparkline for market cards (loop 2).
 *
 * Renders a normalized polyline + soft area fill. The live market passes real
 * in-session probability samples; discovery cards pass a deterministic series
 * seeded from the market id so every card has a stable, distinct trend (these
 * are illustrative until the indexer serves per-market history — same data
 * convention as the rest of the catalog).
 */
export function Sparkline({
  points,
  width = 132,
  height = 30,
  up,
}: {
  points: number[];
  width?: number;
  height?: number;
  up?: boolean;
}) {
  const model = useMemo(() => {
    const pts = points.length >= 2 ? points : [points[0] ?? 0.5, points[0] ?? 0.5];
    let min = Infinity;
    let max = -Infinity;
    for (const p of pts) {
      if (p < min) min = p;
      if (p > max) max = p;
    }
    const span = max - min || 1;
    const n = pts.length;
    const pad = 2;
    const sx = (i: number) => pad + (i / (n - 1)) * (width - pad * 2);
    const sy = (v: number) => pad + (1 - (v - min) / span) * (height - pad * 2);
    let d = `M${sx(0).toFixed(1)},${sy(pts[0]).toFixed(1)}`;
    for (let i = 1; i < n; i++) d += `L${sx(i).toFixed(1)},${sy(pts[i]).toFixed(1)}`;
    const area = d + `L${sx(n - 1).toFixed(1)},${height}L${sx(0).toFixed(1)},${height}Z`;
    const rising = up ?? pts[n - 1] >= pts[0];
    return { d, area, rising };
  }, [points, width, height, up]);

  const color = model.rising ? "#2ebd85" : "#f6465d";
  const gid = `sparkfill-${model.rising ? "u" : "d"}`;
  return (
    <svg className="sparkline" width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.22" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={model.area} fill={`url(#${gid})`} />
      <path d={model.d} fill="none" stroke={color} strokeWidth="1.4" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

/** Deterministic 0..1 probability walk seeded from a string. */
export function seededSeries(seed: string, end: number, n = 24): number[] {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  const rand = () => {
    h ^= h << 13;
    h ^= h >>> 17;
    h ^= h << 5;
    h >>>= 0;
    return h / 4294967296;
  };
  // random walk that lands on `end`, bounded to [0.02, 0.98]
  const out: number[] = [];
  let v = Math.max(0.05, Math.min(0.95, end + (rand() - 0.5) * 0.4));
  for (let i = 0; i < n; i++) {
    const pull = (end - v) * (i / (n - 1)); // drift toward the final value
    v = Math.max(0.02, Math.min(0.98, v + (rand() - 0.5) * 0.08 + pull * 0.25));
    out.push(v);
  }
  out[n - 1] = end;
  return out;
}
