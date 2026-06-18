import { useEffect, useMemo, useRef, useState } from "react";
import { useApp, type AppCommand } from "../state/app";

interface Cmd {
  id: string;
  label: string;
  hint?: string;
  keys?: string;
  group: string;
  run: () => void;
}

/**
 * U2 — command palette + global hotkeys.
 *
 * A single keydown listener drives both the maker hotkeys (cancel-all,
 * cancel-bids/asks, side switch, submit, tab focus) and the ⌘K palette.
 * Commands are dispatched through the app command bus so the owning panel
 * (Make / Positions / Side) executes them — the palette stays presentation.
 */
export function CommandPalette() {
  const { dispatchCommand, marketMode, setMarketMode, faucet, refresh } = useApp();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const commands = useMemo<Cmd[]>(() => {
    const d = (c: AppCommand) => () => dispatchCommand(c);
    return [
      { id: "tab-trade", label: "Go to Trade", keys: "T", group: "Navigate", run: d({ type: "focus-tab", tab: "trade" }) },
      { id: "tab-make", label: "Go to Make", keys: "M", group: "Navigate", run: d({ type: "focus-tab", tab: "make" }) },
      { id: "tab-positions", label: "Go to Positions", keys: "P", group: "Navigate", run: d({ type: "focus-tab", tab: "positions" }) },
      { id: "tab-shadow", label: "Go to Shadow", group: "Navigate", run: d({ type: "focus-tab", tab: "shadow" }) },
      { id: "side-buy", label: "Set side: Buy / Bid", keys: "B", group: "Order", run: d({ type: "set-side", side: "buy" }) },
      { id: "side-sell", label: "Set side: Sell / Ask", keys: "S", group: "Order", run: d({ type: "set-side", side: "sell" }) },
      { id: "toggle-side", label: "Toggle side", keys: "X", group: "Order", run: d({ type: "toggle-side" }) },
      { id: "submit", label: "Submit current order", keys: "↵", group: "Order", run: d({ type: "submit" }) },
      { id: "cancel-all", label: "Cancel ALL open orders", hint: "every live position", keys: "⇧C", group: "Maker", run: d({ type: "cancel-all" }) },
      { id: "cancel-bids", label: "Cancel all BIDS", group: "Maker", run: d({ type: "cancel-bids" }) },
      { id: "cancel-asks", label: "Cancel all ASKS", group: "Maker", run: d({ type: "cancel-asks" }) },
      { id: "claim-all", label: "Claim all proceeds", group: "Maker", run: d({ type: "claim-all" }) },
      {
        id: "mkt-toggle",
        label: marketMode === "prediction" ? "Switch to ETH/USDC" : "Switch to Prediction",
        group: "Market",
        run: () => setMarketMode(marketMode === "prediction" ? "spot" : "prediction"),
      },
      { id: "faucet", label: "Faucet: mint demo balances", group: "Wallet", run: () => void faucet() },
      { id: "refresh", label: "Refresh on-chain state", group: "Data", run: () => refresh() },
    ];
  }, [dispatchCommand, marketMode, setMarketMode, faucet, refresh]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter((c) => (c.label + " " + c.group + " " + (c.hint ?? "")).toLowerCase().includes(q));
  }, [commands, query]);

  // ---- global hotkeys
  useEffect(() => {
    const isTyping = (el: EventTarget | null) => {
      const t = el as HTMLElement | null;
      if (!t) return false;
      const tag = t.tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || t.isContentEditable;
    };
    const onKey = (e: KeyboardEvent) => {
      // ⌘K / Ctrl-K toggles the palette from anywhere
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
        return;
      }
      if (e.key === "Escape" && open) {
        setOpen(false);
        return;
      }
      if (open) return; // palette has its own key handling below
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTyping(e.target)) return;

      switch (e.key) {
        case "?":
          e.preventDefault();
          setOpen(true);
          break;
        case "t": case "T":
          dispatchCommand({ type: "focus-tab", tab: "trade" });
          break;
        case "m": case "M":
          dispatchCommand({ type: "focus-tab", tab: "make" });
          break;
        case "p": case "P":
          dispatchCommand({ type: "focus-tab", tab: "positions" });
          break;
        case "b": case "B":
          dispatchCommand({ type: "set-side", side: "buy" });
          break;
        case "s": case "S":
          dispatchCommand({ type: "set-side", side: "sell" });
          break;
        case "x": case "X":
          dispatchCommand({ type: "toggle-side" });
          break;
        case "C": // shift+c (capital) cancels everything
          if (e.shiftKey) {
            e.preventDefault();
            dispatchCommand({ type: "cancel-all" });
          }
          break;
        case "Enter":
          dispatchCommand({ type: "submit" });
          break;
        default:
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, dispatchCommand]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  useEffect(() => {
    setActive((a) => Math.min(a, Math.max(0, filtered.length - 1)));
  }, [filtered.length]);

  if (!open) return null;

  const runActive = () => {
    const c = filtered[active];
    if (c) {
      c.run();
      setOpen(false);
    }
  };

  return (
    <div className="cmdk-overlay" onMouseDown={() => setOpen(false)}>
      <div className="cmdk" onMouseDown={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="cmdk-input"
          placeholder="Type a command…  (cancel, buy, make, faucet)"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => Math.min(filtered.length - 1, a + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(0, a - 1));
            } else if (e.key === "Enter") {
              e.preventDefault();
              runActive();
            }
          }}
        />
        <div className="cmdk-list">
          {filtered.length === 0 && <div className="cmdk-empty empty-state">no matching command</div>}
          {filtered.map((c, i) => (
            <button
              key={c.id}
              className={`cmdk-item ${i === active ? "cmdk-item-on" : ""}`}
              onMouseEnter={() => setActive(i)}
              onClick={() => {
                c.run();
                setOpen(false);
              }}
            >
              <span className="cmdk-item-main">
                <span className="cmdk-item-label">{c.label}</span>
                {c.hint && <span className="cmdk-item-hint dim">{c.hint}</span>}
              </span>
              <span className="cmdk-item-right">
                <span className="cmdk-group dim">{c.group}</span>
                {c.keys && <kbd className="cmdk-key">{c.keys}</kbd>}
              </span>
            </button>
          ))}
        </div>
        <div className="cmdk-foot dim num">
          <span><kbd className="cmdk-key">↑↓</kbd> move</span>
          <span><kbd className="cmdk-key">↵</kbd> run</span>
          <span><kbd className="cmdk-key">esc</kbd> close</span>
          <span className="cmdk-foot-tip">press <kbd className="cmdk-key">?</kbd> anywhere</span>
        </div>
      </div>
    </div>
  );
}
