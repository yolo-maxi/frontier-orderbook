import { useMemo, useState } from "react";
import { useApp } from "../../state/app";
import { quoteDecimals } from "../../lib/config";
import { fmtCents, fmtPct, type PredictionBook } from "../../lib/prediction";
import { clampProb, fmtUsd } from "../../lib/format";
import { formatUnits } from "viem";

const RANGES = [
  { key: "1H", ms: 60 * 60 * 1000 },
  { key: "6H", ms: 6 * 60 * 60 * 1000 },
  { key: "1D", ms: 24 * 60 * 60 * 1000 },
  { key: "1W", ms: 7 * 24 * 60 * 60 * 1000 },
  { key: "1M", ms: 30 * 24 * 60 * 60 * 1000 },
  { key: "ALL", ms: Infinity },
] as const;

const W = 720;
const H = 230;
const PAD_R = 34;
const PAD_B = 22;

export function ProbabilityChart({ yes }: { yes: PredictionBook }) {
  const { priceHistory, fills, cfg } = useApp();
  const quoteDec = quoteDecimals(cfg);
  const [range, setRange] = useState<(typeof RANGES)[number]["key"]>("ALL");

  // probability series: keep only in-band points (the empty-book start tick
  // maps to ~price 4.85e8 and must not enter the chart).
  const series = useMemo(() => {
    const cutoff =
      range === "ALL" ? -Infinity : Date.now() - RANGES.find((r) => r.key === range)!.ms;
    return priceHistory
      .filter((p) => p.t >= cutoff && p.price > 0 && p.price < 1.2)
      .map((p) => ({ t: p.t, prob: clampProb(p.price) }));
  }, [priceHistory, range]);

  const headlineProb = yes.prob;
  const change = useMemo(() => {
    if (series.length < 2 || headlineProb === null) return null;
    const first = series[0].prob;
    if (first <= 0) return null;
    return ((headlineProb - first) / first) * 100;
  }, [series, headlineProb]);

  const volume = useMemo(
    () => fills.reduce((acc, f) => acc + Number(formatUnits(f.value1, quoteDec)), 0),
    [fills, quoteDec],
  );

  const path = useMemo(() => {
    if (series.length < 2) return null;
    const t0 = series[0].t;
    const t1 = series[series.length - 1].t;
    const span = Math.max(1, t1 - t0);
    const x = (t: number) => ((t - t0) / span) * (W - PAD_R);
    const y = (p: number) => (1 - p) * (H - PAD_B); // 0..1 prob -> full height
    const pts = series.map((s) => `${x(s.t).toFixed(1)},${y(s.prob).toFixed(1)}`);
    const line = `M${pts.join("L")}`;
    const area = `${line}L${x(t1).toFixed(1)},${(H - PAD_B).toFixed(1)}L0,${(H - PAD_B).toFixed(1)}Z`;
    const last = series[series.length - 1];
    return { line, area, cx: x(last.t), cy: y(last.prob) };
  }, [series]);

  const headTone = headlineProb !== null && headlineProb >= 0.5 ? "yes" : "lean";

  return (
    <section className="dbx-chart panel">
      <div className="dbx-chart-head">
        <div className={`dbx-chance ${headTone}`}>
          <span className="num">{headlineProb !== null ? fmtPct(headlineProb) : "—"}</span>
          <span className="dbx-chance-word">chance</span>
          {change !== null && (
            <span className={`dbx-change ${change >= 0 ? "up" : "down"}`}>
              {change >= 0 ? "▲" : "▼"} {Math.abs(change).toFixed(0)}%
            </span>
          )}
        </div>
        <div className="dbx-chart-brand">◢ Frontier</div>
      </div>

      <div className="dbx-chart-plot">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="dbx-svg">
          <defs>
            <linearGradient id="dbxArea" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--db-accent)" stopOpacity="0.30" />
              <stop offset="100%" stopColor="var(--db-accent)" stopOpacity="0" />
            </linearGradient>
          </defs>
          {[0, 0.25, 0.5, 0.75, 1].map((g) => (
            <line
              key={g}
              x1="0"
              x2={W - PAD_R}
              y1={(1 - g) * (H - PAD_B)}
              y2={(1 - g) * (H - PAD_B)}
              className="dbx-grid"
              strokeDasharray="2 4"
            />
          ))}
          {path ? (
            <>
              <path d={path.area} fill="url(#dbxArea)" />
              <path d={path.line} className="dbx-line" fill="none" />
              <circle cx={path.cx} cy={path.cy} r="3.5" className="dbx-dot" />
            </>
          ) : null}
        </svg>
        <div className="dbx-yaxis num">
          {[1, 0.75, 0.5, 0.25, 0].map((g) => (
            <span key={g} style={{ top: `${(1 - g) * 100}%` }}>
              {Math.round(g * 100)}%
            </span>
          ))}
        </div>
        {!path && <div className="dbx-chart-empty">Awaiting first trade — seed the book to start price discovery</div>}
      </div>

      <div className="dbx-chart-foot">
        <div className="dbx-chart-meta num">
          <span>{fmtUsd(volume)} Vol.</span>
          <span className="dim">·</span>
          <span className="dim">{series.length} pts this session</span>
          <span className="dim">·</span>
          <span className="dim">YES {fmtCents(yes.prob)}</span>
        </div>
        <div className="dbx-ranges">
          {RANGES.map((r) => (
            <button key={r.key} className={range === r.key ? "on" : ""} onClick={() => setRange(r.key)}>
              {r.key}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
