import { useState } from "react";
import { useApp } from "../state/app";
import { fmtAmount, shortAddr } from "../lib/format";

export function Header() {
  const { cfg, account, balances, faucet, busy, rpcError, configured } = useApp();
  const [copied, setCopied] = useState(false);
  const [fauceting, setFauceting] = useState(false);

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
        <span className="brand">
          FRONTIER<span className="brand-dot">·</span>CLOB
        </span>
        <span className="pair">WETH / USDC</span>
        <span className="net">
          <span className={`dot ${rpcError ? "dot-bad" : configured ? "dot-ok" : "dot-warn"}`} />
          {cfg.name} <span className="dim">#{cfg.chainId}</span>
        </span>
      </div>
      <div className="hdr-right">
        <div className="bal-group num">
          <span className="bal">
            <span className="dim">WETH</span> {fmtAmount(balances.weth, 4)}
          </span>
          <span className="bal">
            <span className="dim">USDC</span> {fmtAmount(balances.usdc, 2)}
          </span>
          <span className="bal bal-gas" title="Native gas balance">
            <span className="dim">ETH</span> {fmtAmount(balances.eth, 3)}
          </span>
        </div>
        <button className="btn btn-ghost num" onClick={copy} title={account.address}>
          {copied ? "copied" : shortAddr(account.address)}
        </button>
        <button
          className="btn btn-accent"
          onClick={onFaucet}
          disabled={!configured || fauceting || busy !== null}
          title="Mint 10 WETH + 50,000 USDC to the demo wallet"
        >
          {fauceting ? "Minting…" : "Faucet"}
        </button>
      </div>
    </header>
  );
}
