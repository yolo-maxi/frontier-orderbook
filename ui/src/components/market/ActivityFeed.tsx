import { useMemo, useState } from "react";
import { formatUnits } from "viem";
import { useApp } from "../../state/app";
import { baseDecimals, quoteDecimals } from "../../lib/config";
import { fmtAgo, fmtAmount, fmtUsd } from "../../lib/format";
import { fmtCents } from "../../lib/prediction";
import type { Fill, MakerEvent } from "../../state/app";

type Tab = "trades" | "all";

interface Item {
  key: string;
  time: number;
  outcome: "YES" | "NO";
  kind: "buy" | "sell" | "place" | "cancel" | "claim" | "requote";
  shares: number;
  value: number;
  price: number | null;
}

export function ActivityFeed() {
  const { fills, makerEvents, cfg } = useApp();
  const baseDec = baseDecimals(cfg);
  const quoteDec = quoteDecimals(cfg);
  const [tab, setTab] = useState<Tab>("trades");
  const now = Date.now();

  const items = useMemo<Item[]>(() => {
    const trades: Item[] = fills.map((f: Fill) => {
      const shares = Number(formatUnits(f.size0, baseDec));
      const value = Number(formatUnits(f.value1, quoteDec));
      return {
        key: `f-${f.key}`,
        time: f.time,
        outcome: f.outcome,
        kind: f.side,
        shares,
        value,
        price: shares > 0 ? value / shares : null,
      };
    });
    if (tab === "trades") return trades.sort((a, b) => b.time - a.time).slice(0, 24);
    const makers: Item[] = makerEvents.map((m: MakerEvent) => ({
      key: `m-${m.key}`,
      time: m.time,
      outcome: m.outcome,
      kind: m.kind,
      shares: m.total0 !== null ? Number(formatUnits(m.total0, baseDec)) : 0,
      value: 0,
      price: m.priceLo,
    }));
    return [...trades, ...makers].sort((a, b) => b.time - a.time).slice(0, 24);
  }, [fills, makerEvents, tab, baseDec, quoteDec]);

  return (
    <section className="dbx-activity panel">
      <div className="dbx-activity-head">
        <span className="dbx-panel-title">Activity</span>
        <div className="dbx-activity-tabs">
          <button className={tab === "trades" ? "on" : ""} onClick={() => setTab("trades")}>
            Trades
          </button>
          <button className={tab === "all" ? "on" : ""} onClick={() => setTab("all")}>
            All
          </button>
        </div>
      </div>
      <div className="dbx-activity-body">
        {items.length === 0 && (
          <div className="dbx-activity-empty">
            No on-chain activity in range yet. Run the Frontier demo bots to populate the tape.
          </div>
        )}
        {items.map((it) => (
          <div className="dbx-activity-row" key={it.key}>
            <span className={`dbx-act-glyph ${actionTone(it.kind, it.outcome)}`}>{glyph(it.kind)}</span>
            <div className="dbx-act-text">
              <span className="dbx-act-main num">
                {verb(it.kind)} <strong className={it.outcome === "YES" ? "up" : "down"}>{it.outcome}</strong>
                {it.shares > 0 && <> · {fmtAmount(toBig(it.shares, baseDec), 0, baseDec)} sh</>}
                {it.price !== null && <> @ {fmtCents(it.price)}</>}
              </span>
              <span className="dbx-act-sub dim num">
                {it.value > 0 ? fmtUsd(it.value) : "resting"} · {fmtAgo(it.time, now)}
              </span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function toBig(n: number, decimals: number): bigint {
  return BigInt(Math.round(n * 10 ** decimals));
}
function verb(k: Item["kind"]): string {
  switch (k) {
    case "buy":
      return "Bought";
    case "sell":
      return "Sold";
    case "place":
      return "Posted";
    case "cancel":
      return "Cancelled";
    case "claim":
      return "Claimed";
    case "requote":
      return "Requoted";
  }
}
function glyph(k: Item["kind"]): string {
  if (k === "buy") return "▲";
  if (k === "sell") return "▼";
  if (k === "cancel") return "✕";
  if (k === "claim") return "✓";
  return "◇";
}
function actionTone(k: Item["kind"], outcome: "YES" | "NO"): string {
  if (k === "buy") return "up";
  if (k === "sell") return "down";
  return outcome === "YES" ? "up" : "down";
}
