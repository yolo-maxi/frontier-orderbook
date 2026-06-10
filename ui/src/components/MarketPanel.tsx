import { useMemo } from "react";
import { useApp } from "../state/app";
import { fmtAmount, fmtPrice, fmtTime, tickToPrice } from "../lib/format";

export function MarketPanel() {
  const { summary, priceHistory, fills } = useApp();

  const last = summary ? tickToPrice(summary.currentTick) : null;
  const sessionOpen = priceHistory.length > 0 ? priceHistory[0].price : null;
  const change =
    last !== null && sessionOpen !== null && sessionOpen !== 0
      ? ((last - sessionOpen) / sessionOpen) * 100
      : null;
  const bestAsk = summary?.hasAsk ? tickToPrice(summary.bestAsk) : null;
  const bestBid = summary?.hasBid ? tickToPrice(summary.bestBid) : null;
  const spread = bestAsk !== null && bestBid !== null ? bestAsk - bestBid : null;

  return (
    <section className="center-col">
      <div className="panel price-head">
        <div className="ph-main">
          <span className={`ph-last num ${change === null ? "" : change >= 0 ? "up" : "down"}`}>
            {last !== null ? fmtPrice(last, 3) : "—"}
          </span>
          <span className="ph-sub dim">USDC per WETH</span>
        </div>
        <div className="ph-stats num">
          <div className="ph-stat">
            <span className="dim">24h Change</span>
            <span className={change === null ? "" : change >= 0 ? "up" : "down"}>
              {change === null ? "—" : `${change >= 0 ? "+" : ""}${change.toFixed(3)}%`}
            </span>
          </div>
          <div className="ph-stat">
            <span className="dim">Best Bid</span>
            <span className="bid">{bestBid !== null ? fmtPrice(bestBid, 3) : "—"}</span>
          </div>
          <div className="ph-stat">
            <span className="dim">Best Ask</span>
            <span className="ask">{bestAsk !== null ? fmtPrice(bestAsk, 3) : "—"}</span>
          </div>
          <div className="ph-stat">
            <span className="dim">Spread</span>
            <span>{spread !== null ? fmtPrice(spread, 3) : "—"}</span>
          </div>
          <div className="ph-stat">
            <span className="dim">Tick</span>
            <span>{summary ? summary.currentTick.toLocaleString("en-US") : "—"}</span>
          </div>
        </div>
      </div>
      <div className="panel chart-panel">
        <PriceChart />
      </div>
      <div className="panel fills-panel">
        <div className="panel-title">Recent Fills</div>
        <div className="fills-head num">
          <span>Time</span>
          <span>Side</span>
          <span>Price Range</span>
          <span className="ta-r">Size (WETH)</span>
        </div>
        <div className="fills-body">
          {fills.length === 0 && <div className="empty-state">no fills observed yet — fills stream in as takers cross the book</div>}
          {fills.map((f) => (
            <div className="fill-row num" key={f.key}>
              <span className="dim">{fmtTime(f.time)}</span>
              <span className={f.side === "buy" ? "up" : "down"}>
                {f.side === "buy" ? "BUY" : "SELL"}
              </span>
              <span>
                {fmtPrice(f.priceLo, 3)}
                <span className="dim"> → </span>
                {fmtPrice(f.priceHi, 3)}
              </span>
              <span className="ta-r">{fmtAmount(f.size0, 4)}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

const W = 760;
const H = 220;
const PAD = { t: 12, r: 56, b: 18, l: 10 };

function PriceChart() {
  const { priceHistory } = useApp();

  const model = useMemo(() => {
    if (priceHistory.length < 2) return null;
    const pts = priceHistory;
    let min = Infinity;
    let max = -Infinity;
    for (const p of pts) {
      if (p.price < min) min = p.price;
      if (p.price > max) max = p.price;
    }
    if (max - min < 1e-9) {
      const pad = Math.max(max * 0.0005, 0.05);
      min -= pad;
      max += pad;
    } else {
      const pad = (max - min) * 0.12;
      min -= pad;
      max += pad;
    }
    const x0 = pts[0].t;
    const x1 = pts[pts.length - 1].t;
    const xr = Math.max(x1 - x0, 1);
    const sx = (t: number) => PAD.l + ((t - x0) / xr) * (W - PAD.l - PAD.r);
    const sy = (p: number) => PAD.t + (1 - (p - min) / (max - min)) * (H - PAD.t - PAD.b);
    let d = "";
    for (let i = 0; i < pts.length; i++) {
      d += `${i === 0 ? "M" : "L"}${sx(pts[i].t).toFixed(1)},${sy(pts[i].price).toFixed(1)}`;
    }
    const lastPt = pts[pts.length - 1];
    const area =
      d +
      `L${sx(lastPt.t).toFixed(1)},${H - PAD.b}L${sx(pts[0].t).toFixed(1)},${H - PAD.b}Z`;
    const up = lastPt.price >= pts[0].price;
    // grid lines: 4 horizontal
    const grid: { y: number; label: string }[] = [];
    for (let i = 0; i <= 3; i++) {
      const p = min + ((max - min) * i) / 3;
      grid.push({ y: sy(p), label: fmtPrice(p, 2) });
    }
    return { d, area, up, lastY: sy(lastPt.price), lastPrice: lastPt.price, grid };
  }, [priceHistory]);

  if (!model) {
    return <div className="empty-state chart-empty">collecting price history…</div>;
  }

  const stroke = model.up ? "#2ebd85" : "#f6465d";
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart" preserveAspectRatio="none">
      <defs>
        <linearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.18" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      {model.grid.map((g, i) => (
        <g key={i}>
          <line x1={PAD.l} x2={W - PAD.r} y1={g.y} y2={g.y} className="chart-grid" />
          <text x={W - PAD.r + 6} y={g.y + 3} className="chart-axis">
            {g.label}
          </text>
        </g>
      ))}
      <path d={model.area} fill="url(#chartFill)" />
      <path d={model.d} fill="none" stroke={stroke} strokeWidth="1.5" />
      <line
        x1={PAD.l}
        x2={W - PAD.r}
        y1={model.lastY}
        y2={model.lastY}
        className="chart-last-line"
        stroke={stroke}
      />
      <g>
        <rect
          x={W - PAD.r + 2}
          y={model.lastY - 8}
          width={PAD.r - 4}
          height={16}
          rx={2}
          fill={stroke}
        />
        <text x={W - PAD.r + 6} y={model.lastY + 3.5} className="chart-last-label">
          {fmtPrice(model.lastPrice, 2)}
        </text>
      </g>
    </svg>
  );
}
