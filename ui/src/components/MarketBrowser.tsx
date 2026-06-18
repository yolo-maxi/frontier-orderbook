import { useMemo, useState } from "react";
import { useApp } from "../state/app";
import {
  PREDICTION_CATALOG,
  PREDICTION_CATEGORIES,
  type MarketCategory,
} from "../lib/markets";
import { fmtNum } from "../lib/format";
import { ProbabilityPill } from "./ProbabilityPill";
import { Sparkline, seededSeries } from "./Sparkline";

/**
 * P2 — market discovery / browse.
 *
 * A searchable, filterable grid of prediction markets. The live market reads
 * its probability from the on-chain book; the rest show seed probabilities
 * (these are illustrative discovery cards, swappable for indexer-served
 * markets). Selecting a card focuses it as the active prediction market so its
 * metadata + probability flow into the main panel.
 */
export function MarketBrowser({ onClose }: { onClose: () => void }) {
  const { selectedMarketId, setSelectedMarketId, summary, priceHistory } = useApp();
  const [query, setQuery] = useState("");
  const [cat, setCat] = useState<MarketCategory | "All">("All");
  const [sort, setSort] = useState<"volume" | "liquidity" | "closing">("volume");

  const liveProb =
    summary !== null ? Math.max(0, Math.min(1, 1.0001 ** summary.currentTick)) : null;
  // live market sparkline: in-session implied probability (price clamped 0..1)
  const liveSeries = useMemo(() => {
    if (priceHistory.length < 2) return null;
    const step = Math.max(1, Math.floor(priceHistory.length / 24));
    const s: number[] = [];
    for (let i = 0; i < priceHistory.length; i += step) {
      s.push(Math.max(0, Math.min(1, priceHistory[i].price)));
    }
    return s.length >= 2 ? s : null;
  }, [priceHistory]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = PREDICTION_CATALOG.filter((m) => {
      if (cat !== "All" && m.category !== cat) return false;
      if (q && !(m.question.toLowerCase().includes(q) || m.category.toLowerCase().includes(q))) return false;
      return true;
    });
    filtered.sort((a, b) => {
      if (sort === "volume") return b.volume - a.volume;
      if (sort === "liquidity") return b.liquidity - a.liquidity;
      return a.resolutionDate.localeCompare(b.resolutionDate);
    });
    return filtered;
  }, [query, cat, sort]);

  const select = (id: string) => {
    setSelectedMarketId(id);
    onClose();
  };

  return (
    <div className="browser-overlay" onMouseDown={onClose}>
      <div className="browser" onMouseDown={(e) => e.stopPropagation()}>
        <div className="browser-head">
          <div className="browser-title">Discover markets</div>
          <button className="browser-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="browser-controls">
          <input
            className="input browser-search"
            placeholder="Search markets…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
          <div className="browser-sort">
            {(["volume", "liquidity", "closing"] as const).map((s) => (
              <button
                key={s}
                className={`browser-sort-btn ${sort === s ? "browser-sort-on" : ""}`}
                onClick={() => setSort(s)}
              >
                {s === "closing" ? "Closing soon" : s[0].toUpperCase() + s.slice(1)}
              </button>
            ))}
          </div>
        </div>
        <div className="browser-cats">
          <button className={`cat-chip ${cat === "All" ? "cat-on" : ""}`} onClick={() => setCat("All")}>
            All
          </button>
          {PREDICTION_CATEGORIES.map((c) => (
            <button key={c} className={`cat-chip ${cat === c ? "cat-on" : ""}`} onClick={() => setCat(c)}>
              {c}
            </button>
          ))}
        </div>
        <div className="browser-grid">
          {rows.length === 0 && <div className="empty-state browser-empty">no markets match</div>}
          {rows.map((m) => {
            const prob = m.live && liveProb !== null ? liveProb : m.seedProbability;
            const series =
              m.live && liveSeries !== null ? liveSeries : seededSeries(m.id, m.seedProbability);
            return (
              <button
                key={m.id}
                className={`market-card ${m.id === selectedMarketId ? "market-card-on" : ""}`}
                onClick={() => select(m.id)}
              >
                <div className="market-card-top">
                  <span className="market-card-cat">{m.category}</span>
                  {m.live && <span className="market-card-live">LIVE</span>}
                </div>
                <div className="market-card-q">{m.question}</div>
                <div className="market-card-spark">
                  <Sparkline points={series} width={232} height={34} />
                </div>
                <ProbabilityPill price={prob} size="md" />
                <div className="market-card-stats num dim">
                  <span>Vol {fmtNum(m.volume / 1000, 0)}k</span>
                  <span>Liq {fmtNum(m.liquidity / 1000, 0)}k</span>
                  <span>{m.resolutionDate}</span>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
