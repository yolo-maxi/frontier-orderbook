import { useCallback, useMemo, useState } from "react";
import { useApp } from "../state/app";
import {
  baseDecimals,
  marketQuestion,
  noBookAddr,
  noTokenAddr,
  quoteDecimals,
  quoteSymbol,
  yesBookAddr,
  yesTokenAddr,
} from "../lib/config";
import { fmtAmount } from "../lib/format";
import { buildPredictionBooks, exposureFromPositions, fmtCents, type Outcome, type OrderPreview } from "../lib/prediction";
import { MarketHeader } from "./market/MarketHeader";
import { ProbabilityChart } from "./market/ProbabilityChart";
import { DepthBars } from "./market/DepthBars";
import { OrderBookCard } from "./market/OrderBookCard";
import { ActivityFeed } from "./market/ActivityFeed";
import { MarketInfoCards } from "./market/MarketInfoCards";
import { MarketTicket } from "./market/MarketTicket";
import { MirrorLiquidityPane } from "./market/MirrorLiquidityPane";

export function PredictionWorkspace() {
  const { summary, depth, noSummary, noDepth, positions, balances, cfg, mirror, noMirror } = useApp();
  const baseDec = baseDecimals(cfg);
  const quoteDec = quoteDecimals(cfg);
  const quoteSym = quoteSymbol(cfg);
  const question = marketQuestion(cfg);
  const [outcome, setOutcome] = useState<Outcome>("YES");
  const [orderPreview, setOrderPreview] = useState<OrderPreview | null>(null);
  // range-order band (cents), shared so both the ticket inputs and dragging the
  // box on the depth ladder edit the same order
  const [band, setBand] = useState<{ lo: string; hi: string }>({ lo: "", hi: "" });
  const [rangeSizeDrag, setRangeSizeDrag] = useState<{ shares: number; nonce: number } | null>(null);
  const onDragRangeSize = useCallback((shares: number) => {
    setRangeSizeDrag((prev) => ({ shares, nonce: (prev?.nonce ?? 0) + 1 }));
  }, []);

  const [yes, no] = useMemo(
    () => buildPredictionBooks(summary, depth, noSummary, noDepth, baseDec),
    [summary, depth, noSummary, noDepth, baseDec],
  );
  const exposure = useMemo(() => exposureFromPositions(positions, baseDec), [positions, baseDec]);
  const selected = outcome === "YES" ? yes : no;
  const mirrorBook = outcome === "YES" ? yesBookAddr(cfg) : noBookAddr(cfg);
  const mirrorToken = outcome === "YES" ? yesTokenAddr(cfg) : noTokenAddr(cfg);
  const mirrorBalance = outcome === "YES" ? balances.weth : balances.no;
  const mirrorLiquidity = outcome === "YES" ? mirror : noMirror;

  return (
    <main className="dbx-shell">
      <div className="dbx-main">
        <MarketHeader />
        <ProbabilityChart yes={yes} />
        <DepthBars
          outcome={outcome}
          onOutcome={setOutcome}
          yes={yes}
          no={no}
          mirrorLiquidity={mirrorLiquidity}
          preview={orderPreview}
          onDragRange={(lo, hi) => setBand({ lo: String(lo), hi: String(hi) })}
          onDragSize={onDragRangeSize}
        />
        <OrderBookCard outcome={outcome} onOutcome={setOutcome} yes={yes} no={no} />
        <ActivityFeed />
        <MarketInfoCards />
      </div>

      <aside className="dbx-side">
        <div className="dbx-ticket panel">
          <div className="dbx-ticket-head">
            <span className={`dbx-ticket-badge ${outcome.toLowerCase()}`}>{outcome}</span>
            <span className="dbx-ticket-q">{question}</span>
            <span className="dbx-ticket-price num">{fmtCents(selected.prob)}</span>
          </div>
          <MarketTicket
            outcome={outcome}
            onOutcome={setOutcome}
            yes={yes}
            no={no}
            onPreview={setOrderPreview}
            band={band}
            setBand={setBand}
            draggedRangeSize={rangeSizeDrag}
          />
        </div>
        {mirrorBook && mirrorToken ? (
          <MirrorLiquidityPane
            key={mirrorBook}
            bookAddress={mirrorBook}
            outcomeSymbol={outcome}
            outcomeToken={mirrorToken}
            outcomeBalance={mirrorBalance}
          />
        ) : (
          <div className="dbx-mirror-pane">
            <div className="dbx-mirror-head">
              <span className="dbx-mirror-title">
                <i className="dbx-mirror-swatch" /> Mirror liquidity
              </span>
            </div>
            <div className="dbx-note warn">Mirror liquidity is unavailable because this outcome book is not deployed.</div>
          </div>
        )}
        <section className="dbx-portfolio panel">
          <div className="dbx-panel-title">Your position</div>
          <div className="dbx-pf-grid num">
            <PF label="sUSDC" value={fmtAmount(balances.usdc, 2, quoteDec)} />
            <PF label="YES shares" value={fmtAmount(balances.weth, 2, baseDec)} tone="yes" />
            <PF label="NO shares" value={fmtAmount(balances.no, 2, baseDec)} tone="no" />
            <PF label="Live orders" value={String(exposure.liveOrders)} />
          </div>
          <div className="dbx-pf-foot dim">
            Resting {exposure.yesResting.toFixed(2)} · claimable {exposure.yesClaimable.toFixed(2)} {quoteSym}
          </div>
        </section>
      </aside>
    </main>
  );
}

function PF({ label, value, tone }: { label: string; value: string; tone?: "yes" | "no" }) {
  return (
    <div className={`dbx-pf ${tone ?? ""}`}>
      <span className="dbx-pf-label">{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
