import { useApp } from "../../state/app";
import {
  marketResolutionSource,
  marketVaultAddr,
  noBookAddr,
  noTokenAddr,
  quoteSymbol,
  yesBookAddr,
  yesTokenAddr,
} from "../../lib/config";
import { shortAddr } from "../../lib/format";

export function MarketInfoCards() {
  const { cfg } = useApp();
  const quoteSym = quoteSymbol(cfg);
  const marketId = cfg.darkbox?.market?.marketId;
  const rows: Array<[string, string | null | undefined]> = [
    ["Market vault", marketVaultAddr(cfg)],
    ["YES token", yesTokenAddr(cfg)],
    ["NO token", noTokenAddr(cfg)],
    ["YES book", yesBookAddr(cfg)],
    ["NO book", noBookAddr(cfg)],
    ["Collateral", cfg.contracts.usdc],
  ];

  return (
    <section className="dbx-info panel">
      <details open>
        <summary>Resolution</summary>
        <p className="dim">
          This market resolves <strong>YES</strong> if ETH closes above $5,000 at the end of 2026, and <strong>NO</strong> otherwise.
          Source: {marketResolutionSource(cfg)}. On resolution, the winning outcome token redeems 1:1 for {quoteSym} and
          the loser goes to zero; a void splits collateral evenly.
        </p>
      </details>
      <details>
        <summary>How prices work</summary>
        <p className="dim">
          Each price is the market's implied probability in cents — a 27¢ YES share costs {quoteSym} 0.27 and pays{" "}
          {quoteSym} 1.00 if it resolves YES. YES and NO complete to ~$1.00. Liquidity comes from anyone splitting{" "}
          {quoteSym} into a YES + NO set and resting it on the geometric CLOB.
        </p>
      </details>
      <details>
        <summary>Contracts (Frontier testnet)</summary>
        <div className="dbx-info-grid num">
          {marketId && (
            <div className="dbx-info-kv">
              <span className="dim">marketId</span>
              <span>{shortAddr(marketId)}</span>
            </div>
          )}
          {rows.map(([k, v]) => (
            <div className="dbx-info-kv" key={k}>
              <span className="dim">{k}</span>
              <span>{v ? shortAddr(v) : "—"}</span>
            </div>
          ))}
        </div>
      </details>
    </section>
  );
}
