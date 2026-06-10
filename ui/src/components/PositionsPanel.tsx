import { useApp } from "../state/app";
import { bookAbi } from "../abi/book";
import { fmtAmount, fmtPrice, tickToPrice } from "../lib/format";

export function PositionsPanel() {
  const { cfg, wallet, positions, sendTx, busy, refresh } = useApp();

  const onClaim = async (id: bigint, isBid: boolean) => {
    await sendTx(`Claim #${id}`, () =>
      wallet.writeContract({
        address: cfg.contracts.book,
        abi: bookAbi,
        functionName: isBid ? "claimBid" : "claim",
        args: [id],
      }),
    );
    refresh();
  };

  const onCancel = async (id: bigint, isBid: boolean) => {
    await sendTx(`Cancel #${id}`, () =>
      wallet.writeContract({
        address: cfg.contracts.book,
        abi: bookAbi,
        functionName: isBid ? "cancelBid" : "cancel",
        args: [id],
      }),
    );
    refresh();
  };

  if (positions.length === 0) {
    return (
      <div className="positions-empty empty-state">
        No maker positions yet.
        <br />
        <span className="dim">Place a ladder from the Make tab — fills accrue here.</span>
      </div>
    );
  }

  return (
    <div className="positions">
      {positions.map((p) => {
        const lo = tickToPrice(p.lower);
        const hi = tickToPrice(p.upper);
        const claimSym = p.isBid ? "WETH" : "USDC";
        const restSym = p.isBid ? "USDC" : "WETH";
        return (
          <div className={`pos-card ${p.live ? "" : "pos-dead"}`} key={p.id.toString()}>
            <div className="pos-top">
              <span className={`chip ${p.isBid ? "chip-bid" : "chip-ask"}`}>
                {p.isBid ? "BID" : "ASK"}
              </span>
              <span className="num dim">#{p.id.toString()}</span>
              <span className="num pos-range">
                {fmtPrice(lo, 3)} <span className="dim">→</span> {fmtPrice(hi, 3)}
              </span>
              <span className={`pos-status ${p.live ? "live" : ""}`}>
                {p.live ? "live" : "closed"}
              </span>
            </div>
            <div className="pos-grid num">
              <div>
                <span className="dim">Size / level</span>
                <span>{fmtAmount(p.liquidity, 4)} WETH</span>
              </div>
              <div>
                <span className="dim">Resting</span>
                <span>
                  {fmtAmount(p.unfilled, p.isBid ? 2 : 4)} {restSym}
                </span>
              </div>
              <div>
                <span className="dim">Claimable</span>
                <span className={p.claimable > 0n ? "up" : ""}>
                  {fmtAmount(p.claimable, p.isBid ? 4 : 2)} {claimSym}
                </span>
              </div>
              {p.slope !== 0n && (
                <div>
                  <span className="dim">Slope</span>
                  <span>{fmtAmount(p.slope < 0n ? -p.slope : p.slope, 4)}/lvl{p.slope < 0n ? " ↓" : " ↑"}</span>
                </div>
              )}
            </div>
            {p.live && (
              <div className="pos-actions">
                <button
                  className="btn btn-sm btn-buy"
                  disabled={busy !== null || p.claimable === 0n}
                  onClick={() => onClaim(p.id, p.isBid)}
                >
                  Claim
                </button>
                <button
                  className="btn btn-sm btn-ghost"
                  disabled={busy !== null}
                  onClick={() => onCancel(p.id, p.isBid)}
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
