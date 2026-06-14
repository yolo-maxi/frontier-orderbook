import { useState } from "react";
import { encodeFunctionData } from "viem";
import { useApp } from "../state/app";
import { bookAbi } from "../abi/book";
import { alignTick, amountToInput, fmtAmount, fmtPrice, parseAmount, priceToTick, tickToPrice } from "../lib/format";
import { baseDecimals, baseSymbol, quoteDecimals, quoteSymbol } from "../lib/config";

interface Editor {
  id: string; // position id as string
  mode: "move" | "recycle";
  from: string;
  to: string;
  size: string;
}

export function PositionsPanel() {
  const { cfg, client, wallet, account, summary, positions, sendTx, busy, refresh } = useApp();
  const [editor, setEditor] = useState<Editor | null>(null);

  const spacing = summary?.tickSpacing ?? 1;
  const curTick = summary?.currentTick ?? null;
  const mid = curTick !== null ? tickToPrice(curTick) : null;
  const base = baseSymbol(cfg);
  const quoteSym = quoteSymbol(cfg);
  const baseDec = baseDecimals(cfg);
  const quoteDec = quoteDecimals(cfg);

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

  // ---- claim everything in one transaction via the book's multicall;
  // older book deployments without it get sequential claims instead
  const claimables = positions.filter((p) => p.live && p.claimable > 0n);
  const onClaimAll = async () => {
    if (claimables.length === 0) return;
    const calls = claimables.map((p) =>
      encodeFunctionData({
        abi: bookAbi,
        functionName: p.isBid ? "claimBid" : "claim",
        args: [p.id],
      }),
    );
    let batched = false;
    try {
      await client.simulateContract({
        address: cfg.contracts.book,
        abi: bookAbi,
        functionName: "multicall",
        args: [calls],
        account: account.address,
      });
      batched = true;
    } catch {
      batched = false; // book predates multicall — fall back
    }
    if (batched) {
      await sendTx(`Claim ${claimables.length} positions (1 tx)`, () =>
        wallet.writeContract({
          address: cfg.contracts.book,
          abi: bookAbi,
          functionName: "multicall",
          args: [calls],
        }),
      );
    } else {
      for (const p of claimables) {
        // eslint-disable-next-line no-await-in-loop
        await sendTx(`Claim #${p.id}`, () =>
          wallet.writeContract({
            address: cfg.contracts.book,
            abi: bookAbi,
            functionName: p.isBid ? "claimBid" : "claim",
            args: [p.id],
          }),
        );
      }
    }
    refresh();
  };

  const openMove = (p: { id: bigint; lower: number; upper: number; liquidity: bigint }) =>
    setEditor({
      id: p.id.toString(),
      mode: "move",
      from: tickToPrice(p.lower).toFixed(3),
      to: tickToPrice(p.upper).toFixed(3),
      size: amountToInput(p.liquidity, baseDec),
    });

  const openRecycle = (p: { id: bigint; isBid: boolean; claimable: bigint }) => {
    if (mid === null) return;
    // recycle flips sides: a filled bid's base token becomes an ask, a filled
    // ask's quote token becomes a bid — prefill one level at the touch
    const from = p.isBid ? mid + 0.01 : mid - 0.011;
    const to = p.isBid ? mid + 0.011 : mid - 0.01;
    const size = p.isBid
      ? Number(amountToInput(p.claimable, baseDec)) // base directly
      : Number(amountToInput(p.claimable, quoteDec)) / mid; // quote -> base at ~mid
    setEditor({
      id: p.id.toString(),
      mode: "recycle",
      from: from.toFixed(3),
      to: to.toFixed(3),
      size: size.toFixed(6),
    });
  };

  const onEditorSubmit = async (p: { id: bigint; isBid: boolean }) => {
    if (!editor) return;
    const loP = Math.min(Number(editor.from), Number(editor.to));
    const hiP = Math.max(Number(editor.from), Number(editor.to));
    const size = parseAmount(editor.size, baseDec);
    if (!Number.isFinite(loP) || !Number.isFinite(hiP) || size === null || size === 0n) return;
    const lower = alignTick(priceToTick(loP), spacing, false);
    let upper = alignTick(priceToTick(hiP), spacing, true);
    if (upper <= lower) upper = lower + spacing;

    if (editor.mode === "move") {
      await sendTx(`Move #${p.id} to ${fmtPrice(loP, 3)}–${fmtPrice(hiP, 3)}`, () =>
        wallet.writeContract({
          address: cfg.contracts.book,
          abi: bookAbi,
          functionName: p.isBid ? "requoteBid" : "requote",
          args: [p.id, lower, upper, size],
        }),
      );
    } else {
      await sendTx(`Recycle #${p.id} into ${p.isBid ? "ask" : "bid"}`, () =>
        p.isBid
          ? wallet.writeContract({
              address: cfg.contracts.book,
              abi: bookAbi,
              functionName: "recycleBidIntoAsk",
              args: [p.id, lower, upper, size, 0n],
            })
          : wallet.writeContract({
              address: cfg.contracts.book,
              abi: bookAbi,
              functionName: "recycleAskIntoBid",
              args: [p.id, lower, upper, size],
            }),
      );
    }
    setEditor(null);
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
      {claimables.length > 1 && (
        <button className="btn btn-wide btn-buy claim-all" disabled={busy !== null} onClick={onClaimAll}>
          Claim all ({claimables.length} positions, 1 tx)
        </button>
      )}
      {positions.map((p) => {
        const lo = tickToPrice(p.lower);
        const hi = tickToPrice(p.upper);
        const claimSym = p.isBid ? base : quoteSym;
        const restSym = p.isBid ? quoteSym : base;
        const ed = editor !== null && editor.id === p.id.toString() ? editor : null;
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
                <span>{fmtAmount(p.liquidity, 4, baseDec)} {base}</span>
              </div>
              <div>
                <span className="dim">Resting</span>
                <span>
                  {fmtAmount(p.unfilled, p.isBid ? 2 : 4, p.isBid ? quoteDec : baseDec)} {restSym}
                </span>
              </div>
              <div>
                <span className="dim">Claimable</span>
                <span className={p.claimable > 0n ? "up" : ""}>
                  {fmtAmount(p.claimable, p.isBid ? 4 : 2, p.isBid ? baseDec : quoteDec)} {claimSym}
                </span>
              </div>
              {p.slope !== 0n && (
                <div>
                  <span className="dim">Slope</span>
                  <span>{fmtAmount(p.slope < 0n ? -p.slope : p.slope, 4, baseDec)}/lvl{p.slope < 0n ? " ↓" : " ↑"}</span>
                </div>
              )}
            </div>
            {p.live && !ed && (
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
                  onClick={() => openMove(p)}
                >
                  Move
                </button>
                <button
                  className="btn btn-sm btn-ghost"
                  disabled={busy !== null || p.claimable === 0n}
                  title="Claim into internal credit and quote the other side — zero token transfers"
                  onClick={() => openRecycle(p)}
                >
                  Recycle
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
            {p.live && ed && (
              <div className="pos-editor">
                <div className="pos-editor-title dim">
                  {ed.mode === "move"
                    ? "Move quote (re-price in place, no token movement at same size)"
                    : `Recycle fills into a new ${p.isBid ? "ask" : "bid"} (zero transfers)`}
                </div>
                <div className="field-row">
                  <input
                    className="input num"
                    value={ed.from}
                    onChange={(e) => setEditor({ ...ed, from: e.target.value })}
                    placeholder="from price"
                  />
                  <input
                    className="input num"
                    value={ed.to}
                    onChange={(e) => setEditor({ ...ed, to: e.target.value })}
                    placeholder="to price"
                  />
                  <input
                    className="input num"
                    value={ed.size}
                    onChange={(e) => setEditor({ ...ed, size: e.target.value })}
                    placeholder="size/level"
                  />
                </div>
                <div className="pos-actions">
                  <button
                    className="btn btn-sm btn-buy"
                    disabled={busy !== null}
                    onClick={() => onEditorSubmit(p)}
                  >
                    {ed.mode === "move" ? "Move" : "Recycle"}
                  </button>
                  <button className="btn btn-sm btn-ghost" onClick={() => setEditor(null)}>
                    Back
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
