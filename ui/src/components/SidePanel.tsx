import { useState } from "react";
import { TradePanel } from "./TradePanel";
import { MakePanel } from "./MakePanel";
import { PositionsPanel } from "./PositionsPanel";
import { useApp } from "../state/app";

type Tab = "trade" | "make" | "positions";

export function SidePanel() {
  const [tab, setTab] = useState<Tab>("trade");
  const { positions } = useApp();
  const liveCount = positions.filter((p) => p.live).length;

  return (
    <section className="panel side-panel">
      <div className="tabs">
        <button className={`tab ${tab === "trade" ? "tab-on" : ""}`} onClick={() => setTab("trade")}>
          Trade
        </button>
        <button className={`tab ${tab === "make" ? "tab-on" : ""}`} onClick={() => setTab("make")}>
          Make
        </button>
        <button
          className={`tab ${tab === "positions" ? "tab-on" : ""}`}
          onClick={() => setTab("positions")}
        >
          Positions{liveCount > 0 ? <span className="tab-badge num">{liveCount}</span> : null}
        </button>
      </div>
      <div className="side-body">
        {tab === "trade" && <TradePanel />}
        {tab === "make" && <MakePanel />}
        {tab === "positions" && <PositionsPanel />}
      </div>
    </section>
  );
}
