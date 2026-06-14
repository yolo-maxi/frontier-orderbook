import { useMemo, useState } from "react";
import { useApp } from "../state/app";
import { fmtAmount, shortAddr } from "../lib/format";
import { baseDecimals, baseSymbol, quoteDecimals, quoteSymbol } from "../lib/config";
import { Brand } from "./Brand";

function TokenGlyph({ sym, label }: { sym: "base" | "quote" | "eth"; label?: string }) {
  const letter = sym === "eth" ? "Ξ" : (label ?? sym).slice(0, 1).toUpperCase();
  return <span className={`tok-glyph tok-${sym === "base" ? "weth" : sym === "quote" ? "usdc" : "eth"}`}>{letter}</span>;
}

/** Deterministic identicon-ish gradient dot derived from the address. */
function identGradient(address: string): string {
  let h = 0;
  for (let i = 2; i < address.length; i++) {
    h = (h * 31 + address.charCodeAt(i)) >>> 0;
  }
  const hue1 = h % 360;
  const hue2 = (hue1 + 80 + (h >> 9) % 120) % 360;
  return `linear-gradient(135deg, hsl(${hue1} 70% 55%), hsl(${hue2} 70% 45%))`;
}

export function Header() {
  const { cfg, addr, walletKind, connect, disconnect, connecting, balances, faucet, busy, rpcError, configured } =
    useApp();
  const [copied, setCopied] = useState(false);
  const [fauceting, setFauceting] = useState(false);
  const [connErr, setConnErr] = useState<string | null>(null);

  const base = baseSymbol(cfg);
  const quote = quoteSymbol(cfg);
  const baseDec = baseDecimals(cfg);
  const quoteDec = quoteDecimals(cfg);
  const connected = walletKind === "injected";
  const identBg = useMemo(() => identGradient(addr), [addr]);

  const copy = () => {
    navigator.clipboard?.writeText(addr).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    });
  };

  const onConnect = async () => {
    setConnErr(null);
    try {
      await connect();
    } catch (e) {
      setConnErr(e instanceof Error ? e.message : "Connect failed");
      setTimeout(() => setConnErr(null), 5000);
    }
  };

  const onFaucet = async () => {
    setFauceting(true);
    try {
      await faucet();
    } finally {
      setFauceting(false);
    }
  };

  return (
    <header className="hdr">
      <div className="hdr-left">
        <Brand />
        <span className="hdr-sep" />
        <span className="pair">
          <span className="pair-glyphs">
            <TokenGlyph sym="base" label={base} />
            <TokenGlyph sym="quote" label={quote} />
          </span>
          YES / NO
        </span>
        <span className="net">
          <span className={`dot ${rpcError ? "dot-bad" : configured ? "dot-ok" : "dot-warn"}`} />
          {cfg.name} <span className="dim num">#{cfg.chainId}</span>
        </span>
      </div>
      <div className="hdr-right">
        <div className="bal-group num">
          <span className="bal">
            <TokenGlyph sym="base" label={base} /> {fmtAmount(balances.weth, 4, baseDec)}
          </span>
          <span className="bal">
            <TokenGlyph sym="quote" label={quote} /> {fmtAmount(balances.usdc, 2, quoteDec)}
          </span>
          <span className="bal bal-gas" title="Native gas balance">
            <TokenGlyph sym="eth" /> {fmtAmount(balances.eth, 3)}
          </span>
        </div>
        <button
          className={`wallet-chip ${connected ? "wallet-connected" : "wallet-demo"}`}
          onClick={copy}
          title={connected ? `Connected: ${addr}` : `Demo wallet: ${addr}`}
        >
          <span className="ident-dot" style={{ background: identBg }} />
          {copied ? "copied" : connected ? shortAddr(addr) : `demo · ${shortAddr(addr)}`}
        </button>
        {configured && (
          <button
            className="btn btn-ghost btn-faucet"
            onClick={onFaucet}
            disabled={fauceting || busy !== null}
            title={`Mint demo ${quote} to the active wallet (ARC testnet)`}
          >
            {fauceting ? "Minting…" : `Get ${quote}`}
          </button>
        )}
        {connected ? (
          <button className="btn btn-ghost" onClick={disconnect} title="Disconnect wallet">
            Disconnect
          </button>
        ) : (
          <button
            className="btn btn-connect"
            onClick={onConnect}
            disabled={connecting}
            title={connErr ?? "Connect a browser wallet (MetaMask, Rabby, …) on ARC testnet"}
          >
            {connecting ? "Connecting…" : "Connect Wallet"}
          </button>
        )}
      </div>
      {connErr && <div className="banner banner-bad">Wallet: {connErr}</div>}
    </header>
  );
}
