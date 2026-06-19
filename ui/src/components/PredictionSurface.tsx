import { useEffect, useMemo } from "react";
import { useApp } from "../state/app";
import { fmtNum, fmtPredictionPct, predictionPriceToProbability, tickToPrice } from "../lib/format";
import { ProbabilityPill } from "./ProbabilityPill";
import { Sparkline, seededSeries } from "./Sparkline";
import { TradePanel } from "./TradePanel";
import { ShadowPanel } from "./ShadowPanel";
import { OrderBook } from "./OrderBook";

export function PredictionSurface() {
  const { summary, predictionMeta, marketStats, market, setCopyFocus, setMakeFocus } = useApp();
  const rawPrice = summary ? tickToPrice(summary.currentTick) : null;
  const yesProb = rawPrice === null ? predictionMeta.seedProbability : predictionPriceToProbability(rawPrice);
  const noProb = 1 - yesProb;
  const resolveDate = new Date(predictionMeta.resolutionDate + "T00:00:00Z").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const series = useMemo(
    () => seededSeries(predictionMeta.id, Math.max(0.02, Math.min(0.98, yesProb)), 36),
    [predictionMeta.id, yesProb],
  );
  useEffect(() => {
    setMakeFocus(true);
    setCopyFocus(true);
    return () => {
      setMakeFocus(false);
      setCopyFocus(false);
    };
  }, [setCopyFocus, setMakeFocus]);

  return (
    <main className="pm-surface">
      <section className="pm-main">
        <div className="panel pm-market">
          <div className="pm-market-top">
            <span className="pred-cat">{predictionMeta.category}</span>
            <span className="pred-meta-stats num dim">
              Vol {fmtNum((marketStats?.volume ?? predictionMeta.volume) / 1000, 0)}k {market.quoteSymbol}
              {" · "}Liq {fmtNum((marketStats?.liquidity ?? predictionMeta.liquidity) / 1000, 0)}k
              {" · "}resolves {resolveDate}
            </span>
          </div>
          <h1 className="pm-question">{predictionMeta.question}</h1>
          <div className="pm-resolution">{predictionMeta.resolution}</div>
          <div className="pm-outcomes">
            <OutcomeCard label="YES" price={yesProb} tone="yes" />
            <OutcomeCard label="NO" price={noProb} tone="no" />
          </div>
        </div>

        <div className="panel pm-prob-panel">
          <div className="pm-panel-head">
            <div>
              <span className="pm-kicker">Probability</span>
              <div className="pm-big-prob num">{fmtPredictionPct(rawPrice ?? yesProb, 1)}</div>
            </div>
            <ProbabilityPill price={rawPrice ?? yesProb} size="lg" />
          </div>
          <div className="pm-chart-wrap">
            <Sparkline points={series} width={720} height={150} up={series[series.length - 1] >= series[0]} />
          </div>
          <div className="pm-axis num dim">
            <span>24h low {fmtNum(Math.min(...series) * 100, 1)}%</span>
            <span>last {fmtNum(yesProb * 100, 1)}%</span>
            <span>24h high {fmtNum(Math.max(...series) * 100, 1)}%</span>
          </div>
        </div>

        <div className="pm-depth">
          <OrderBook />
        </div>
      </section>

      <aside className="pm-rail">
        <div className="panel pm-ticket">
          <div className="pm-ticket-head">
            <span>Trade outcome</span>
            <span className="num dim">{fmtNum(yesProb * 100, 1)}% YES</span>
          </div>
          <TradePanel />
        </div>
        <ShadowPanel />
      </aside>
    </main>
  );
}

function OutcomeCard({ label, price, tone }: { label: "YES" | "NO"; price: number; tone: "yes" | "no" }) {
  return (
    <div className={`pm-outcome pm-outcome-${tone}`}>
      <span className="pm-outcome-label">{label}</span>
      <span className="pm-outcome-price num">{fmtNum(price * 100, 1)}c</span>
      <button className={`pm-outcome-btn ${tone === "yes" ? "btn-buy" : "btn-sell"}`}>Buy {label}</button>
    </div>
  );
}
