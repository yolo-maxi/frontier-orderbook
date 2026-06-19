import { useMemo, useState } from "react";
import { useApp } from "../state/app";
import { fmtAmount, shortAddr } from "../lib/format";
import { baseDecimals, quoteDecimals } from "../lib/config";
import { Brand } from "./Brand";
import { MarketBrowser } from "./MarketBrowser";
import { Portfolio } from "./Portfolio";

function TokenGlyph({ sym, glyph }: { sym: "base" | "quote" | "eth"; glyph: string }) {
  const letter = sym === "eth" ? "Ξ" : glyph;
  return <span className={`tok-glyph tok-${sym}`}>{letter}</span>;
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
  const { cfg, account, balances, faucet, busy, rpcError, configured, market, marketMode } = useApp();
  const [copied, setCopied] = useState(false);
  const [fauceting, setFauceting] = useState(false);
  const [browseOpen, setBrowseOpen] = useState(false);
  const [portfolioOpen, setPortfolioOpen] = useState(false);

  const baseDec = baseDecimals(cfg);
  const quoteDec = quoteDecimals(cfg);
  const question = cfg.darkbox?.market?.question;
  const faucetAvailable = !cfg.darkbox;
  const identBg = useMemo(() => identGradient(account.address), [account.address]);
  const isPrediction = marketMode === "prediction";
  const venueLabel = isPrediction ? "Outcome market" : cfg.name;
  const venueDetail = isPrediction ? "YES/NO market" : "Spot CLOB";

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
        <Brand tag={isPrediction ? "PM" : "CLOB"} />
        <span className="hdr-sep" />
        <span className="pair">
          <span className="pair-glyphs">
            <TokenGlyph sym="base" glyph={market.baseGlyph} />
            <TokenGlyph sym="quote" glyph={market.quoteGlyph} />
          </span>
          {market.pairLabel}
        </span>
        <span className="net">
          <span className={`dot ${rpcError ? "dot-bad" : configured ? "dot-ok" : "dot-warn"}`} />
          {question ?? venueLabel} <span className="dim">{venueDetail}</span>{" "}
          <span className="dim num">#{cfg.chainId}</span>
        </span>
      </div>
      <div className="hdr-right">
        <div className="bal-group num">
          <span className="bal">
            <TokenGlyph sym="base" glyph={market.baseGlyph} /> {fmtAmount(balances.weth, 4, baseDec)}
          </span>
          <span className="bal">
            <TokenGlyph sym="quote" glyph={market.quoteGlyph} /> {fmtAmount(balances.usdc, 2, quoteDec)}
          </span>
          <span className="bal bal-gas" title="Native gas balance">
            <TokenGlyph sym="eth" glyph="Ξ" /> {fmtAmount(balances.eth, 3)}
          </span>
        </div>
        {isPrediction && (
          <>
            <button className="btn btn-ghost btn-discover" onClick={() => setBrowseOpen(true)} title="Browse prediction markets">
              Discover
            </button>
            <button className="btn btn-ghost btn-discover" onClick={() => setPortfolioOpen(true)} title="Your positions, PnL and activity">
              Portfolio
            </button>
          </>
        )}
        <button className="wallet-chip" onClick={copy} title={account.address}>
          <span className="ident-dot" style={{ background: identBg }} />
          {copied ? "copied" : shortAddr(account.address)}
        </button>
        <button
          className="btn btn-accent"
          onClick={onFaucet}
          disabled={!configured || !faucetAvailable || fauceting || busy !== null}
          title={faucetAvailable ? market.faucetTitle : "DarkBox market tokens come from seeded/split collateral, not the demo faucet"}
        >
          {!faucetAvailable ? "Seeded market" : fauceting ? "Minting…" : "Faucet"}
        </button>
      </div>
      {browseOpen && <MarketBrowser onClose={() => setBrowseOpen(false)} />}
      {portfolioOpen && <Portfolio onClose={() => setPortfolioOpen(false)} />}
    </header>
  );
}
