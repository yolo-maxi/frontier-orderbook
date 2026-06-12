import { useMemo, useState } from "react";
import { formatUnits } from "viem";
import { useApp } from "../state/app";
import { fmtAmount, fmtPrice, fmtTime, tickToPrice } from "../lib/format";
import {
  buildPredictionBooks,
  complementSignal,
  exposureFromPositions,
  fmtPct,
  fmtProb,
  type Outcome,
  type PredictionBook,
  type PredictionLevel,
} from "../lib/prediction";
import { TradePanel } from "./TradePanel";
import { MakePanel } from "./MakePanel";
import { PositionsPanel } from "./PositionsPanel";

type TicketTab = "trade" | "make" | "positions";

export function PredictionWorkspace() {
  const { summary, depth, fills, makerEvents, positions, cfg } = useApp();
  const [yes, no] = useMemo(() => buildPredictionBooks(summary, depth), [summary, depth]);
  const signal = useMemo(() => complementSignal(yes, no), [yes, no]);
  const exposure = useMemo(() => exposureFromPositions(positions), [positions]);
  const [outcome, setOutcome] = useState<Outcome>("YES");
  const [tab, setTab] = useState<TicketTab>("trade");
  const selected = outcome === "YES" ? yes : no;

  return (
    <main className="pm-shell">
      <section className="pm-hero panel">
        <div className="pm-question">
          <div className="microlabel">Frontier prediction market</div>
          <h1>Will ETH close above $2,000 on Friday?</h1>
          <div className="pm-meta">
            <span>Resolution source: Frontier oracle demo</span>
            <span>Friday 20:00 UTC</span>
            <span>Chain #{cfg.chainId}</span>
          </div>
        </div>
        <div className="pm-hero-stats">
          <Metric label="YES mid" value={fmtProb(yes.mid)} tone="yes" />
          <Metric label="NO mid" value={fmtProb(no.mid)} tone="no" />
          <Metric
            label="YES + NO asks"
            value={fmtProb(signal.yesAskNoAsk)}
            tone={signal.askOverround !== null && signal.askOverround > 0.01 ? "warn" : ""}
          />
          <Metric label="Live source" value="YES book" />
        </div>
      </section>

      <section className="pm-arb panel">
        <div>
          <span className="microlabel">Complement monitor</span>
          <strong>{signal.hint}</strong>
        </div>
        <div className="pm-arb-grid num">
          <span>YES ask + NO ask {fmtProb(signal.yesAskNoAsk)}</span>
          <span>Overround {fmtPct(signal.askOverround)}</span>
          <span>YES bid + NO bid {fmtProb(signal.yesBidNoBid)}</span>
          <span>Bid gap {fmtPct(signal.bidUnderround)}</span>
        </div>
      </section>

      <section className="pm-layout">
        <div className="pm-left">
          <div className="pm-books">
            <OutcomeBook book={yes} active={outcome === "YES"} onSelect={() => setOutcome("YES")} />
            <OutcomeBook book={no} active={outcome === "NO"} onSelect={() => setOutcome("NO")} />
          </div>
          <div className="pm-lower">
            <MarketTape fills={fills} makerCount={makerEvents.length} />
            <ExposurePanel
              liveOrders={exposure.liveOrders}
              yesResting={exposure.yesResting}
              yesClaimable={exposure.yesClaimable}
              maxLoss={exposure.maxLoss}
              maxPayout={exposure.maxPayout}
            />
          </div>
        </div>

        <aside className="pm-ticket panel">
          <div className="pm-outcome-tabs">
            <button className={outcome === "YES" ? "pm-tab-on" : ""} onClick={() => setOutcome("YES")}>
              YES
            </button>
            <button className={outcome === "NO" ? "pm-tab-on" : ""} onClick={() => setOutcome("NO")}>
              NO
            </button>
          </div>
          <div className="pm-ticket-head">
            <div>
              <span className="microlabel">{selected.source === "live" ? "Live execution" : "Synthetic leg"}</span>
              <h2>{selected.outcome} ticket</h2>
            </div>
            <div className="pm-ticket-mid num">{fmtProb(selected.mid)}</div>
          </div>
          <div className="pm-ticket-tabs">
            <button className={tab === "trade" ? "pm-tab-on" : ""} onClick={() => setTab("trade")}>
              Trade
            </button>
            <button className={tab === "make" ? "pm-tab-on" : ""} onClick={() => setTab("make")}>
              Quote
            </button>
            <button className={tab === "positions" ? "pm-tab-on" : ""} onClick={() => setTab("positions")}>
              Positions
            </button>
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
        </aside>
      </section>
      <div className="pm-note">
        YES is the deployed Frontier CLOB adapter over the live ETH/USDC devnet book. NO is a complement adapter derived as 1 - YES until a second deployed book address is added to the manifest.
      </div>
    </main>
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

function OutcomeBook({ book, active, onSelect }: { book: PredictionBook; active: boolean; onSelect: () => void }) {
  const maxCum = Math.max(1, ...book.askDepth.map((d) => d.cum), ...book.bidDepth.map((d) => d.cum));
  return (
    <article className={`pm-book panel ${active ? "pm-book-active" : ""}`}>
      <button className="pm-book-top" onClick={onSelect}>
        <span className={`pm-outcome-badge ${book.outcome.toLowerCase()}`}>{book.outcome}</span>
        <span className="pm-source">{book.source === "live" ? "live CLOB" : "synthetic complement"}</span>
        <strong className="num">{fmtProb(book.mid)}</strong>
      </button>
      <div className="pm-book-stats num">
        <span>Bid {fmtProb(book.bestBid)}</span>
        <span>Ask {fmtProb(book.bestAsk)}</span>
        <span>Spread {fmtProb(book.spread)}</span>
      </div>
      <div className="pm-book-head num">
        <span>Prob.</span>
        <span>Shares</span>
        <span>Total</span>
      </div>
      <div className="pm-ladder asks">
        {book.askDepth.slice().reverse().map((l, i) => (
          <DepthRow key={`a${i}-${l.probability}`} level={l} maxCum={maxCum} side="ask" />
        ))}
      </div>
      <div className="pm-midline num">{fmtProb(book.mid)} midpoint</div>
      <div className="pm-ladder bids">
        {book.bidDepth.map((l, i) => (
          <DepthRow key={`b${i}-${l.probability}`} level={l} maxCum={maxCum} side="bid" />
        ))}
      </div>
    </article>
  );
}

function DepthRow({ level, maxCum, side }: { level: PredictionLevel; maxCum: number; side: "ask" | "bid" }) {
  return (
    <div className="pm-depth-row num">
      <span className={`pm-depth-bar ${side}`} style={{ width: `${Math.min(100, (level.cum / maxCum) * 100)}%` }} />
      <span className={side === "ask" ? "ask" : "bid"}>{fmtProb(level.probability)}</span>
      <span>{level.size.toFixed(3)}</span>
      <span className="dim">{level.cum.toFixed(3)}</span>
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
      <div className="note warn">NO is priced from the live YES book but cannot submit transactions until a second book is deployed.</div>
      <label className="field">
        <span className="field-label">
          Spend <span className="dim">(USDC)</span>
        </span>
        <input className="input num" inputMode="decimal" value={spend} onChange={(e) => setSpend(e.target.value)} />
      </label>
      <div className="quote-box num">
        <div className="qrow">
          <span className="dim">Buy price</span>
          <span>{fmtProb(book.bestAsk)}</span>
        </div>
        <div className="qrow">
          <span className="dim">Shares</span>
          <span>{Number.isFinite(shares) ? shares.toFixed(2) : "-"}</span>
        </div>
        <div className="qrow">
          <span className="dim">Max payout</span>
          <span>{Number.isFinite(shares) ? `$${shares.toFixed(2)}` : "-"}</span>
        </div>
        <div className="qrow">
          <span className="dim">Profit if resolves NO</span>
          <span className="up">{Number.isFinite(profit) ? `$${profit.toFixed(2)}` : "-"}</span>
        </div>
        <div className="qrow">
          <span className="dim">Breakeven</span>
          <span>{fmtProb(book.bestAsk)}</span>
        </div>
      </div>
      <button className="btn btn-wide" disabled>
        Deploy NO book to enable
      </button>
    </div>
  );
}

function MarketTape({ fills, makerCount }: { fills: ReturnType<typeof useApp>["fills"]; makerCount: number }) {
  return (
    <section className="pm-feed panel">
      <div className="panel-title">
        Prediction tape <span className="title-note">live book events</span>
      </div>
      <div className="pm-feed-head num">
        <span>Time</span>
        <span>Action</span>
        <span>Raw px</span>
        <span className="ta-r">Size</span>
      </div>
      <div className="pm-feed-body">
        {fills.slice(0, 10).map((f) => {
          const size = Number(formatUnits(f.size0, 18));
          const value = Number(formatUnits(f.value1, 18));
          const avg = size > 0 ? value / size : tickToPrice(0);
          return (
            <div className="pm-feed-row num" key={f.key}>
              <span className="dim">{fmtTime(f.time)}</span>
              <span className={f.side === "buy" ? "up" : "down"}>{f.side === "buy" ? "BUY YES" : "SELL YES"}</span>
              <span>{fmtPrice(avg, 2)}</span>
              <span className="ta-r">{fmtAmount(f.size0, 4)}</span>
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
    <section className="pm-exposure panel">
      <div className="panel-title">Portfolio</div>
      <div className="pm-exposure-grid num">
        <Metric label="Live orders" value={String(liveOrders)} />
        <Metric label="YES resting" value={yesResting.toFixed(3)} />
        <Metric label="Claimable" value={yesClaimable.toFixed(3)} />
        <Metric label="Max loss" value={`$${maxLoss.toFixed(2)}`} tone="warn" />
        <Metric label="Max payout" value={`$${maxPayout.toFixed(2)}`} tone="yes" />
      </div>
    </section>
  );
}
