import { useCallback, useEffect, useState } from "react";
import { useApp } from "../../state/app";
import { erc20Abi } from "../../abi/erc20";
import { marketAbi, MARKET_STATUS, OUTCOME } from "../../abi/market";
import { baseDecimals, marketVaultAddr, quoteDecimals, quoteSymbol } from "../../lib/config";
import { fmtAmount, parseAmount } from "../../lib/format";

type Mode = "split" | "merge" | "redeem";
const MAX_UINT = 2n ** 256n - 1n;

export function LiquidityCard() {
  const { cfg, client, wallet, addr, balances, sendTx, busy } = useApp();
  const market = marketVaultAddr(cfg);
  const quoteDec = quoteDecimals(cfg);
  const baseDec = baseDecimals(cfg);
  const quoteSym = quoteSymbol(cfg);

  const [mode, setMode] = useState<Mode>("split");
  const [amountStr, setAmountStr] = useState("");
  const [allowance, setAllowance] = useState<bigint | null>(null);
  const [status, setStatus] = useState<number | null>(null);
  const [resolved, setResolved] = useState<number>(0);

  const loadState = useCallback(async () => {
    if (!market) return;
    try {
      const [st, res, allow] = await Promise.all([
        client.readContract({ address: market, abi: marketAbi, functionName: "status" }),
        client.readContract({ address: market, abi: marketAbi, functionName: "resolvedOutcome" }),
        client.readContract({
          address: cfg.contracts.usdc,
          abi: erc20Abi,
          functionName: "allowance",
          args: [addr, market],
        }),
      ]);
      setStatus(Number(st));
      setResolved(Number(res));
      setAllowance(allow);
    } catch {
      /* market views optional */
    }
  }, [client, market, cfg, addr]);
  useEffect(() => {
    loadState();
  }, [loadState, busy]);

  if (!market) return null;

  const isResolved = status === 4; // MarketStatus.Resolved
  const amount = parseAmount(amountStr, mode === "split" ? quoteDec : baseDec);
  const pairBalance = balances.weth < balances.no ? balances.weth : balances.no; // min(YES, NO)
  const balForMode = mode === "split" ? balances.usdc : mode === "merge" ? pairBalance : winnerBalance();
  const insufficient = amount !== null && amount > balForMode;
  const splitNeedsApproval = mode === "split" && allowance !== null && amount !== null && allowance < amount;

  function winnerBalance(): bigint {
    if (resolved === OUTCOME.Yes) return balances.weth;
    if (resolved === OUTCOME.No) return balances.no;
    return balances.weth + balances.no; // void: either side redeems
  }

  const onApprove = () =>
    sendTx(`Approve ${quoteSym} for vault`, () =>
      wallet.writeContract({
        address: cfg.contracts.usdc,
        abi: erc20Abi,
        functionName: "approve",
        args: [market, MAX_UINT],
      }),
    ).then(() => loadState());

  const onSubmit = async () => {
    if (amount === null || amount === 0n) return;
    if (mode === "split") {
      const ok = await sendTx(`Split ${fmtAmount(amount, 2, quoteDec)} ${quoteSym} → YES + NO`, () =>
        wallet.writeContract({
          address: market,
          abi: marketAbi,
          functionName: "split",
          args: [amount, addr],
        }),
      );
      if (ok) setAmountStr("");
    } else if (mode === "merge") {
      const ok = await sendTx(`Merge ${fmtAmount(amount, 2, baseDec)} pairs → ${quoteSym}`, () =>
        wallet.writeContract({
          address: market,
          abi: marketAbi,
          functionName: "merge",
          args: [amount, addr],
        }),
      );
      if (ok) setAmountStr("");
    } else {
      const winner = resolved === OUTCOME.No ? OUTCOME.No : OUTCOME.Yes;
      const ok = await sendTx(`Redeem ${fmtAmount(amount, 2, baseDec)} ${winner === OUTCOME.Yes ? "YES" : "NO"}`, () =>
        wallet.writeContract({
          address: market,
          abi: marketAbi,
          functionName: "redeem",
          args: [winner, amount, addr],
        }),
      );
      if (ok) setAmountStr("");
    }
  };

  return (
    <section className="dbx-liq panel">
      <div className="dbx-liq-head">
        <span className="dbx-panel-title">◳ Frontier Liquidity</span>
        <span className={`dbx-liq-status ${isResolved ? "resolved" : "active"}`}>
          {status !== null ? MARKET_STATUS[status] ?? "—" : "—"}
        </span>
      </div>
      <p className="dbx-liq-blurb dim">
        Mint a complete <strong>YES + NO</strong> set from {quoteSym} collateral, or merge a set back. One set always
        redeems for exactly 1 {quoteSym} — this is how the book gets its inventory.
      </p>

      <div className="dbx-liq-modes">
        <button className={mode === "split" ? "on" : ""} onClick={() => setMode("split")}>
          Split
        </button>
        <button className={mode === "merge" ? "on" : ""} onClick={() => setMode("merge")}>
          Merge
        </button>
        {isResolved && (
          <button className={mode === "redeem" ? "on" : ""} onClick={() => setMode("redeem")}>
            Redeem
          </button>
        )}
      </div>

      <div className="dbx-field">
        <label className="dbx-field-label">
          {mode === "split" ? `${quoteSym} to lock` : mode === "merge" ? "Pairs to merge" : "Winning shares"}
          <button
            className="dbx-bal num"
            onClick={() => setAmountStr((Number(balForMode) / 10 ** (mode === "split" ? quoteDec : baseDec)).toString())}
          >
            {mode === "split"
              ? `${fmtAmount(balForMode, 2, quoteDec)} ${quoteSym}`
              : `${fmtAmount(balForMode, 2, baseDec)} sh`}
          </button>
        </label>
        <div className="dbx-amount">
          <input
            className="num"
            inputMode="decimal"
            placeholder="0.00"
            value={amountStr}
            onChange={(e) => setAmountStr(e.target.value)}
          />
        </div>
      </div>

      <div className="dbx-liq-flow num">
        {mode === "split" ? (
          <>
            <span className="dim">{amountStr || "0"} {quoteSym}</span>
            <span className="dbx-flow-arrow">→</span>
            <span className="up">{amountStr || "0"} YES</span>
            <span className="dim">+</span>
            <span className="down">{amountStr || "0"} NO</span>
          </>
        ) : mode === "merge" ? (
          <>
            <span className="up">{amountStr || "0"} YES</span>
            <span className="dim">+</span>
            <span className="down">{amountStr || "0"} NO</span>
            <span className="dbx-flow-arrow">→</span>
            <span className="dim">{amountStr || "0"} {quoteSym}</span>
          </>
        ) : (
          <>
            <span className={resolved === OUTCOME.No ? "down" : "up"}>
              {amountStr || "0"} {resolved === OUTCOME.No ? "NO" : "YES"}
            </span>
            <span className="dbx-flow-arrow">→</span>
            <span className="dim">{amountStr || "0"} {quoteSym}</span>
          </>
        )}
      </div>

      {insufficient ? (
        <button className="dbx-cta" disabled>
          Insufficient balance
        </button>
      ) : splitNeedsApproval ? (
        <button className="dbx-cta approve" disabled={busy !== null} onClick={onApprove}>
          Approve {quoteSym}
        </button>
      ) : (
        <button
          className="dbx-cta liq"
          disabled={busy !== null || amount === null || amount === 0n}
          onClick={onSubmit}
        >
          {mode === "split" ? "Split into YES + NO" : mode === "merge" ? "Merge into " + quoteSym : "Redeem winnings"}
        </button>
      )}
    </section>
  );
}
