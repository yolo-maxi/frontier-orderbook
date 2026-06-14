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
  const { cfg, account, balances, faucet, busy, rpcError, configured } = useApp();
  const [copied, setCopied] = useState(false);
  const [fauceting, setFauceting] = useState(false);

  const base = baseSymbol(cfg);
  const quote = quoteSymbol(cfg);
  const baseDec = baseDecimals(cfg);
  const quoteDec = quoteDecimals(cfg);
  const faucetAvailable = !cfg.darkbox;
  const identBg = useMemo(() => identGradient(account.address), [account.address]);

  const copy = () => {
    navigator.clipboard?.writeText(account.address).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    });
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
        <button className="wallet-chip" onClick={copy} title={account.address}>
          <span className="ident-dot" style={{ background: identBg }} />
          {copied ? "copied" : shortAddr(account.address)}
        </button>
        <button
          className="btn btn-accent"
          onClick={onFaucet}
          disabled={!configured || !faucetAvailable || fauceting || busy !== null}
          title={faucetAvailable ? `Mint demo ${base}/${quote} balances` : "DarkBox market is pre-seeded"}
        >
          {!faucetAvailable ? "Seeded market" : fauceting ? "Minting…" : "Faucet"}
        </button>
      </div>
    </header>
  );
}
