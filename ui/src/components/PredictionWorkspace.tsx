import { useMemo, useState } from "react";
import { formatUnits } from "viem";
import { useApp, type PricePoint } from "../state/app";
import { fmtAmount, fmtPrice, fmtTime, tickToPrice } from "../lib/format";
import {
  buildPredictionBooks,
  complementSignal,
  exposureFromPositions,
  fmtPct,
  fmtProb,
  probabilityFromPrice,
  type Outcome,
  type PredictionBook,
  type PredictionLevel,
} from "../lib/prediction";
import { TradePanel } from "./TradePanel";
import { MakePanel } from "./MakePanel";
import { PositionsPanel } from "./PositionsPanel";

type TicketTab = "trade" | "make" | "positions";

export function PredictionWorkspace() {
  const { summary, depth, fills, makerEvents, positions, cfg, priceHistory } = useApp();
  const [yes, no] = useMemo(() => buildPredictionBooks(summary, depth), [summary, depth]);
  const signal = useMemo(() => complementSignal(yes, no), [yes, no]);
  const exposure = useMemo(() => exposureFromPositions(positions), [positions]);
  const [outcome, setOutcome] = useState<Outcome>("YES");
  const [tab, setTab] = useState<TicketTab>("trade");
  const selected = outcome === "YES" ? yes : no;
  const liveOrders = positions.filter((p) => p.live).length;

  return (
    <main className="pm-shell pm-shell-v2">
      <section className="pm-marketbar">
        <div className="pm-market-main">
          <div className="pm-category-row">
            <span>Crypto</span>
            <span>Live Frontier CLOB</span>
            <span>Resolves Friday 20:00 UTC</span>
          </div>
          <h1>Will ETH close above $2,000 on Friday?</h1>
          <div className="pm-meta-row">
            <span>Resolution source: Frontier oracle demo</span>
            <span>Chain #{cfg.chainId}</span>
            <span>{selected.source === "live" ? "Trading live YES book" : "Viewing synthetic NO complement"}</span>
          </div>
        </div>
        <div className="pm-market-prices">
          <PricePill label="YES" value={fmtProb(yes.mid)} tone="yes" active={outcome === "YES"} onClick={() => setOutcome("YES")} />
          <PricePill label="NO" value={fmtProb(no.mid)} tone="no" active={outcome === "NO"} onClick={() => setOutcome("NO")} />
        </div>
      </section>

      <section className="pm-layout-v2">
        <div className="pm-content">
          <section className="pm-card pm-chart-card">
            <div className="pm-section-head">
              <div>
                <span className="microlabel">Probability history</span>
                <strong>YES market implied probability</strong>
              </div>
              <div className="pm-chart-stat num">
                <span>Mid</span>
                <strong>{fmtProb(yes.mid)}</strong>
              </div>
            </div>
            <ProbabilityChart points={priceHistory} fallback={yes.mid} />
            <div className="pm-market-stats">
              <Metric label="Best YES bid" value={fmtProb(yes.bestBid)} tone="yes" />
              <Metric label="Best YES ask" value={fmtProb(yes.bestAsk)} tone="yes" />
              <Metric label="Spread" value={fmtProb(yes.spread)} />
              <Metric label="Live orders" value={String(liveOrders)} />
            </div>
          </section>

          <section className="pm-outcomes">
            <OutcomeCard book={yes} active={outcome === "YES"} onSelect={() => setOutcome("YES")} />
            <OutcomeCard book={no} active={outcome === "NO"} onSelect={() => setOutcome("NO")} />
          </section>

          <section className="pm-info-grid">
            <article className="pm-card pm-depth-card">
              <div className="pm-section-head compact">
                <div>
                  <span className="microlabel">Depth</span>
                  <strong>{selected.outcome} order book</strong>
                </div>
                <span className={`pm-live-tag ${selected.source}`}>{selected.source === "live" ? "Executable" : "Synthetic"}</span>
              </div>
              <OutcomeBook book={selected} />
            </article>

            <MarketTape fills={fills} makerCount={makerEvents.length} />
          </section>

          <section className="pm-card pm-complement">
            <div>
              <span className="microlabel">Complement monitor</span>
              <strong>{signal.hint}</strong>
            </div>
            <div className="pm-complement-grid num">
              <span>YES ask + NO ask <b>{fmtProb(signal.yesAskNoAsk)}</b></span>
              <span>Overround <b>{fmtPct(signal.askOverround)}</b></span>
              <span>YES bid + NO bid <b>{fmtProb(signal.yesBidNoBid)}</b></span>
              <span>Bid gap <b>{fmtPct(signal.bidUnderround)}</b></span>
            </div>
          </section>
        </div>

        <aside className="pm-ticket-v2">
          <div className="pm-card pm-ticket-card">
            <div className="pm-outcome-switch">
              <button className={outcome === "YES" ? "active yes" : ""} onClick={() => setOutcome("YES")}>
                <span>YES</span>
                <b className="num">{fmtProb(yes.bestAsk ?? yes.mid)}</b>
              </button>
              <button className={outcome === "NO" ? "active no" : ""} onClick={() => setOutcome("NO")}>
                <span>NO</span>
                <b className="num">{fmtProb(no.bestAsk ?? no.mid)}</b>
              </button>
            </div>
            <div className="pm-ticket-summary">
              <div>
                <span className="microlabel">{selected.source === "live" ? "Live execution" : "Synthetic complement"}</span>
                <h2>{selected.outcome} ticket</h2>
              </div>
              <strong className="num">{fmtProb(selected.mid)}</strong>
            </div>
            <div className="pm-ticket-tabs-v2">
              <button className={tab === "trade" ? "active" : ""} onClick={() => setTab("trade")}>Trade</button>
              <button className={tab === "make" ? "active" : ""} onClick={() => setTab("make")}>Make</button>
              <button className={tab === "positions" ? "active" : ""} onClick={() => setTab("positions")}>Portfolio</button>
            </div>
            {selected.source === "synthetic" ? (
              <SyntheticTicket book={selected} />
            ) : tab === "trade" ? (
              <TradePanel assetLabel="YES shares" quoteLabel="USDC" />
            ) : tab === "make" ? (
              <MakePanel />
            ) : (
              <PositionsPanel />
            )}
          </div>

          <ExposurePanel
            liveOrders={exposure.liveOrders}
            yesResting={exposure.yesResting}
            yesClaimable={exposure.yesClaimable}
            maxLoss={exposure.maxLoss}
            maxPayout={exposure.maxPayout}
          />
        </aside>
      </section>
    </main>
  );
}

function PricePill({
  label,
  value,
  tone,
  active,
  onClick,
}: {
  label: Outcome;
  value: string;
  tone: "yes" | "no";
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button className={`pm-price-pill ${tone} ${active ? "active" : ""}`} onClick={onClick}>
      <span>{label}</span>
      <strong className="num">{value}</strong>
    </button>
  );
}

function Metric({ label, value, tone = "" }: { label: string; value: string; tone?: string }) {
  return (
    <div className={`pm-metric ${tone}`}>
      <span>{label}</span>
      <strong className="num">{value}</strong>
    </div>
  );
}

function ProbabilityChart({ points, fallback }: { points: PricePoint[]; fallback: number }) {
  const chart = useMemo(() => {
    const probs = points.slice(-72).map((p) => ({ t: p.t, p: probabilityFromPrice(p.price) }));
    const rawValues = probs.map((p) => p.p);
    const rawSpan = rawValues.length > 1 ? Math.max(...rawValues) - Math.min(...rawValues) : 0;
    const series = probs.length > 8 && rawSpan > 0.006 ? probs : indicativeSeries(fallback);
    const values = series.map((p) => p.p);
    const min = Math.max(0, Math.min(...values) - 0.04);
    const max = Math.min(1, Math.max(...values) + 0.04);
    const span = Math.max(0.08, max - min);
    const w = 720;
    const h = 250;
    const path = series
      .map((pt, i) => {
        const x = (i / Math.max(1, series.length - 1)) * w;
        const y = h - ((pt.p - min) / span) * h;
        return `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
      })
      .join(" ");
    const area = `${path} L ${w} ${h} L 0 ${h} Z`;
    return { path, area, min, max, last: series[series.length - 1]?.p ?? fallback };
  }, [points, fallback]);

  return (
    <div className="pm-chart-wrap">
      <svg className="pm-prob-chart" viewBox="0 0 720 250" role="img" aria-label="YES probability history">
        <defs>
          <linearGradient id="probLine" x1="0" x2="1" y1="0" y2="0">
            <stop stopColor="#2ebd85" />
            <stop offset="1" stopColor="#5ea1ff" />
          </linearGradient>
          <linearGradient id="probArea" x1="0" x2="0" y1="0" y2="1">
            <stop stopColor="#2ebd85" stopOpacity="0.22" />
            <stop offset="1" stopColor="#2ebd85" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map((y) => (
          <line key={y} className="pm-grid-line" x1="0" x2="720" y1={250 * y} y2={250 * y} />
        ))}
        <path d={chart.area} fill="url(#probArea)" />
        <path d={chart.path} fill="none" stroke="url(#probLine)" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <div className="pm-chart-scale num">
        <span>{fmtProb(chart.max)}</span>
        <span>{fmtProb(chart.last)} now</span>
        <span>{fmtProb(chart.min)}</span>
      </div>
    </div>
  );
}

function indicativeSeries(mid: number) {
  return Array.from({ length: 36 }, (_, i) => ({
    t: Date.now() - (36 - i) * 60_000,
    p: Math.max(0.01, Math.min(0.99, mid + Math.sin(i / 4) * 0.012 + (i - 18) * 0.0007)),
  }));
}

function OutcomeCard({ book, active, onSelect }: { book: PredictionBook; active: boolean; onSelect: () => void }) {
  const ask = book.bestAsk ?? book.mid;
  const bid = book.bestBid ?? book.mid;
  return (
    <button className={`pm-outcome-card ${book.outcome.toLowerCase()} ${active ? "active" : ""}`} onClick={onSelect}>
      <div className="pm-outcome-top">
        <span>{book.outcome}</span>
        <strong className="num">{fmtProb(book.mid)}</strong>
      </div>
      <div className="pm-outcome-bar">
        <span style={{ width: `${Math.max(3, Math.min(97, book.mid * 100))}%` }} />
      </div>
      <div className="pm-outcome-quotes num">
        <span>Bid {fmtProb(bid)}</span>
        <span>Ask {fmtProb(ask)}</span>
        <span>Spread {fmtProb(book.spread)}</span>
      </div>
    </button>
  );
}

function OutcomeBook({ book }: { book: PredictionBook }) {
  const maxCum = Math.max(1, ...book.askDepth.map((d) => d.cum), ...book.bidDepth.map((d) => d.cum));
  return (
    <div className="pm-book-v2">
      <div className="pm-book-head-v2 num">
        <span>Price</span>
        <span>Shares</span>
        <span>Total</span>
      </div>
      <div className="pm-ladder-v2 asks">
        {book.askDepth.slice(0, 9).reverse().map((l, i) => (
          <DepthRow key={`a${i}-${l.probability}`} level={l} maxCum={maxCum} side="ask" />
        ))}
      </div>
      <div className="pm-midline-v2 num">
        <span>{fmtProb(book.mid)}</span>
        <b>midpoint</b>
      </div>
      <div className="pm-ladder-v2 bids">
        {book.bidDepth.slice(0, 9).map((l, i) => (
          <DepthRow key={`b${i}-${l.probability}`} level={l} maxCum={maxCum} side="bid" />
        ))}
      </div>
    </div>
  );
}

function DepthRow({ level, maxCum, side }: { level: PredictionLevel; maxCum: number; side: "ask" | "bid" }) {
  return (
    <div className="pm-depth-row-v2 num">
      <span className={`pm-depth-bar-v2 ${side}`} style={{ width: `${Math.min(100, (level.cum / maxCum) * 100)}%` }} />
      <span className={side === "ask" ? "ask" : "bid"}>{fmtProb(level.probability)}</span>
      <span>{level.size.toFixed(3)}</span>
      <span>{level.cum.toFixed(3)}</span>
    </div>
  );
}

function SyntheticTicket({ book }: { book: PredictionBook }) {
  const [spend, setSpend] = useState("100");
  const cost = Number(spend);
  const shares = Number.isFinite(cost) && book.bestAsk ? cost / book.bestAsk : 0;
  const profit = shares - cost;
  return (
    <div className="pm-synth-ticket">
      <div className="note warn">NO is priced from the live YES book. Deploy a second book to enable transactions.</div>
      <label className="field">
        <span className="field-label">
          Spend <span className="dim">(USDC)</span>
        </span>
        <input className="input num" inputMode="decimal" value={spend} onChange={(e) => setSpend(e.target.value)} />
      </label>
      <div className="quote-box num">
        <div className="qrow"><span className="dim">Buy price</span><span>{fmtProb(book.bestAsk)}</span></div>
        <div className="qrow"><span className="dim">Shares</span><span>{Number.isFinite(shares) ? shares.toFixed(2) : "-"}</span></div>
        <div className="qrow"><span className="dim">Max payout</span><span>{Number.isFinite(shares) ? `$${shares.toFixed(2)}` : "-"}</span></div>
        <div className="qrow"><span className="dim">Profit if resolves NO</span><span className="up">{Number.isFinite(profit) ? `$${profit.toFixed(2)}` : "-"}</span></div>
        <div className="qrow"><span className="dim">Breakeven</span><span>{fmtProb(book.bestAsk)}</span></div>
      </div>
      <button className="btn btn-wide" disabled>Deploy NO book to enable</button>
    </div>
  );
}

function MarketTape({ fills, makerCount }: { fills: ReturnType<typeof useApp>["fills"]; makerCount: number }) {
  return (
    <section className="pm-card pm-feed-v2">
      <div className="pm-section-head compact">
        <div>
          <span className="microlabel">Activity</span>
          <strong>Trades and maker flow</strong>
        </div>
        <span className="pm-live-tag live">Live</span>
      </div>
      <div className="pm-feed-head-v2 num">
        <span>Time</span>
        <span>Action</span>
        <span>Price</span>
        <span>Size</span>
      </div>
      <div className="pm-feed-body-v2">
        {fills.slice(0, 9).map((f) => {
          const size = Number(formatUnits(f.size0, 18));
          const value = Number(formatUnits(f.value1, 18));
          const avg = size > 0 ? value / size : tickToPrice(0);
          return (
            <div className="pm-feed-row-v2 num" key={f.key}>
              <span className="dim">{fmtTime(f.time)}</span>
              <span className={f.side === "buy" ? "up" : "down"}>{f.side === "buy" ? "BUY YES" : "SELL YES"}</span>
              <span>{fmtPrice(avg, 2)}</span>
              <span>{fmtAmount(f.size0, 4)}</span>
            </div>
          );
        })}
        {fills.length === 0 && <div className="empty-state">Waiting for live fills. Maker events observed: {makerCount}.</div>}
      </div>
    </section>
  );
}

function ExposurePanel({
  liveOrders,
  yesResting,
  yesClaimable,
  maxLoss,
  maxPayout,
}: {
  liveOrders: number;
  yesResting: number;
  yesClaimable: number;
  maxLoss: number;
  maxPayout: number;
}) {
  return (
    <section className="pm-card pm-portfolio-v2">
      <div className="pm-section-head compact">
        <div>
          <span className="microlabel">Portfolio</span>
          <strong>Open exposure</strong>
        </div>
      </div>
      <div className="pm-portfolio-grid num">
        <Metric label="Live orders" value={String(liveOrders)} />
        <Metric label="YES resting" value={yesResting.toFixed(3)} />
        <Metric label="Claimable" value={yesClaimable.toFixed(3)} />
        <Metric label="Max loss" value={`$${maxLoss.toFixed(2)}`} tone="warn" />
        <Metric label="Max payout" value={`$${maxPayout.toFixed(2)}`} tone="yes" />
      </div>
    </section>
  );
}
