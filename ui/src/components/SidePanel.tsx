import { useEffect, useState } from "react";
import { TradePanel } from "./TradePanel";
import { MakePanel } from "./MakePanel";
import { ShadowPanel } from "./ShadowPanel";
import { PositionsPanel } from "./PositionsPanel";
import { InventoryWidget } from "./InventoryWidget";
import { useApp } from "../state/app";

type Tab = "trade" | "make" | "shadow" | "positions";

export function SidePanel() {
  const [tab, setTab] = useState<Tab>("trade");
  const { positions, setMakeFocus, onCommand } = useApp();
  // Make + Copy modes expand the book portion of the screen
  useEffect(() => {
    setMakeFocus(tab === "make" || tab === "shadow");
    return () => setMakeFocus(false);
  }, [tab, setMakeFocus]);

  // U2 — hotkeys / palette can jump to any tab. A quote-at-price command
  // (click-to-quote from the order book) also focuses the Make tab so the
  // ladder editor is visible when it prefills.
  useEffect(
    () =>
      onCommand((cmd) => {
        if (cmd.type === "focus-tab") setTab(cmd.tab);
        else if (cmd.type === "cancel-all" || cmd.type === "cancel-bids" || cmd.type === "cancel-asks" || cmd.type === "claim-all") {
          setTab("positions");
        } else if (cmd.type === "quote-at-price") {
          setTab("make");
        }
      }),
    [onCommand],
  );
  const liveCount = positions.filter((p) => p.live).length;

  return (
    <section className="panel side-panel">
      <InventoryWidget />
      <div className="tabs">
        <button className={`tab ${tab === "trade" ? "tab-on" : ""}`} onClick={() => setTab("trade")}>
          Trade
        </button>
        <button className={`tab ${tab === "make" ? "tab-on" : ""}`} onClick={() => setTab("make")}>
          Make
        </button>
        <button className={`tab ${tab === "shadow" ? "tab-on" : ""}`} onClick={() => setTab("shadow")}>
          Copy
        </button>
        <button
          className={`tab ${tab === "positions" ? "tab-on" : ""}`}
          onClick={() => setTab("positions")}
        >
          Positions{liveCount > 0 ? <span className="tab-badge num">{liveCount}</span> : null}
        </button>
      </div>
      <div className="side-body">
        <div className="tab-pane" key={tab}>
          {tab === "trade" && <TradePanel />}
          {tab === "make" && <MakePanel />}
          {tab === "shadow" && <ShadowPanel />}
          {tab === "positions" && <PositionsPanel />}
        </div>
      </div>
    </section>
  );
}
