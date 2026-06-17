import { useCallback, useEffect, useMemo, useState } from "react";
import { useApp } from "../state/app";
import { bookAbi } from "../abi/book";
import { erc20Abi } from "../abi/erc20";
import { amountToInput, fmtAmount, parseAmount } from "../lib/format";
import { baseDecimals, quoteDecimals } from "../lib/config";

const MAX_UINT = 2n ** 256n - 1n;

/**
 * Shadow liquidity = a single pooled inventory that mirrors real fills at the
 * book price. LPs add token0 + token1, earn the book spread on mirrored size,
 * and pay a protocol fee on every mirror (no maker treatment). It is the third
 * way to provide liquidity here, alongside Bid and Ask ladders — but instead of
 * resting at a chosen price, it rides whatever the real book prints.
 */
export function ShadowPanel() {
  const { cfg, client, wallet, account, balances, shadow, sendTx, busy, refresh, market } = useApp();
  const baseDec = baseDecimals(cfg);
  const quoteDec = quoteDecimals(cfg);

  const [mode, setMode] = useState<"deposit" | "withdraw">("deposit");
  const [amt0Str, setAmt0Str] = useState("");
  const [amt1Str, setAmt1Str] = useState("");
  const [withdrawPct, setWithdrawPct] = useState(100);
  const [allow0, setAllow0] = useState<bigint | null>(null);
  const [allow1, setAllow1] = useState<bigint | null>(null);

  const amt0 = parseAmount(amt0Str, baseDec);
  const amt1 = parseAmount(amt1Str, quoteDec);

  const firstDeposit = shadow.totalShares === 0n;
  // After the first deposit the pool has a fixed ratio; show it so LPs know the
  // smaller of the two amounts is what actually binds.
  const ratio =
    shadow.reserve0 > 0n
      ? Number(shadow.reserve1) / Number(shadow.reserve0)
      : null;

  const myValue0 =
    shadow.totalShares > 0n ? (shadow.myShares * shadow.reserve0) / shadow.totalShares : 0n;
  const myValue1 =
    shadow.totalShares > 0n ? (shadow.myShares * shadow.reserve1) / shadow.totalShares : 0n;

  const loadAllowances = useCallback(async () => {
    try {
      const [a0, a1] = await Promise.all([
        client.readContract({
          address: cfg.contracts.weth,
          abi: erc20Abi,
          functionName: "allowance",
          args: [account.address, cfg.contracts.book],
        }),
        client.readContract({
          address: cfg.contracts.usdc,
          abi: erc20Abi,
          functionName: "allowance",
          args: [account.address, cfg.contracts.book],
        }),
      ]);
      setAllow0(a0);
      setAllow1(a1);
    } catch {
      setAllow0(null);
      setAllow1(null);
    }
  }, [client, cfg, account]);

  useEffect(() => {
    loadAllowances();
  }, [loadAllowances, busy]);

  const ready = mode === "deposit" && (amt0 ?? 0n) > 0n && (amt1 ?? 0n) > 0n;
  const insufficient =
    ready && ((amt0 ?? 0n) > balances.weth || (amt1 ?? 0n) > balances.usdc);
  const needs0 = ready && allow0 !== null && allow0 < (amt0 ?? 0n);
  const needs1 = ready && allow1 !== null && allow1 < (amt1 ?? 0n);

  const approve = (token: `0x${string}`, sym: string) =>
    sendTx(`Approve ${sym} for shadow pool`, () =>
      wallet.writeContract({
        address: token,
        abi: erc20Abi,
        functionName: "approve",
        args: [cfg.contracts.book, MAX_UINT],
      }),
    ).then(() => loadAllowances());

  const onDeposit = async () => {
    if (!ready || amt0 === null || amt1 === null) return;
    const ok = await sendTx("Add shadow liquidity", () =>
      wallet.writeContract({
        address: cfg.contracts.book,
        abi: bookAbi,
        functionName: "depositShadow",
        args: [amt0, amt1, 0n],
      }),
    );
    if (ok) {
      setAmt0Str("");
      setAmt1Str("");
      refresh();
    }
  };

  const withdrawShares = useMemo(
    () => (shadow.myShares * BigInt(Math.round(withdrawPct * 100))) / 10000n,
    [shadow.myShares, withdrawPct],
  );

  const onWithdraw = async () => {
    if (withdrawShares === 0n) return;
    const ok = await sendTx("Withdraw shadow liquidity", () =>
      wallet.writeContract({
        address: cfg.contracts.book,
        abi: bookAbi,
        functionName: "withdrawShadow",
        args: [withdrawShares, 0n, 0n],
      }),
    );
    if (ok) refresh();
  };

  return (
    <div className="trade-panel">
      <div className="shadow-explainer">
        <div className="shadow-explainer-head">
          <i className="shadow-swatch" /> Shadow liquidity
        </div>
        <p className="dim">
          Pooled inventory that <b>mirrors real fills</b> at the book price — depth without a
          price view. It makes a thin {market.mode === "prediction" ? "prediction" : "spot"} book
          fill deeper. Mirrors pay <b>{shadow.feeBps} bps</b> to the protocol and earn no maker
          rebate, so resting makers keep their edge.
        </p>
      </div>

      <div className="seg">
        <button
          className={`seg-btn ${mode === "deposit" ? "seg-buy" : ""}`}
          onClick={() => setMode("deposit")}
        >
          Add
        </button>
        <button
          className={`seg-btn ${mode === "withdraw" ? "seg-sell" : ""}`}
          onClick={() => setMode("withdraw")}
        >
          Withdraw
        </button>
      </div>

      <div className="quote-box num">
        <div className="qrow">
          <span className="dim">Pooled {market.baseSymbol}</span>
          <span>{fmtAmount(shadow.reserve0, 4, baseDec)}</span>
        </div>
        <div className="qrow">
          <span className="dim">Pooled {market.quoteSymbol}</span>
          <span>{fmtAmount(shadow.reserve1, 2, quoteDec)}</span>
        </div>
        <div className="qrow">
          <span className="dim">Your share</span>
          <span>
            {shadow.totalShares > 0n
              ? `${((Number(shadow.myShares) / Number(shadow.totalShares)) * 100).toFixed(2)}%`
              : "—"}
          </span>
        </div>
        {shadow.myShares > 0n && (
          <div className="qrow">
            <span className="dim">Your inventory</span>
            <span>
              {fmtAmount(myValue0, 4, baseDec)} {market.baseSymbol} ·{" "}
              {fmtAmount(myValue1, 2, quoteDec)} {market.quoteSymbol}
            </span>
          </div>
        )}
      </div>

      {mode === "deposit" ? (
        <>
          <div className="field-row">
            <label className="field">
              <span className="field-label">
                {market.baseSymbol} amount
                <span className="field-bal num">bal {fmtAmount(balances.weth, 4, baseDec)}</span>
              </span>
              <input
                className="input num"
                inputMode="decimal"
                placeholder="0.0"
                value={amt0Str}
                onChange={(e) => setAmt0Str(e.target.value)}
              />
            </label>
            <label className="field">
              <span className="field-label">
                {market.quoteSymbol} amount
                <span className="field-bal num">bal {fmtAmount(balances.usdc, 2, quoteDec)}</span>
              </span>
              <input
                className="input num"
                inputMode="decimal"
                placeholder="0.0"
                value={amt1Str}
                onChange={(e) => setAmt1Str(e.target.value)}
              />
            </label>
          </div>

          {!firstDeposit && ratio !== null && (
            <div className="note dim-note">
              Pool ratio is {ratio.toFixed(2)} {market.quoteSymbol}/{market.baseSymbol}; deposits
              are clipped to it and the unused remainder stays in your wallet.{" "}
              {amt0 !== null && amt0 > 0n && (
                <button
                  className="link-btn"
                  onClick={() => setAmt1Str(amountToInput((amt0 * shadow.reserve1) / shadow.reserve0, quoteDec))}
                >
                  match {market.quoteSymbol}
                </button>
              )}
            </div>
          )}
          {firstDeposit && (
            <div className="note dim-note">
              First deposit sets the pool ratio — both amounts are required and define the price
              the pool mirrors around.
            </div>
          )}

          {needs0 && !insufficient ? (
            <button className="btn btn-wide btn-accent" disabled={busy !== null} onClick={() => approve(cfg.contracts.weth, market.baseSymbol)}>
              Approve {market.baseSymbol}
            </button>
          ) : needs1 && !insufficient ? (
            <button className="btn btn-wide btn-accent" disabled={busy !== null} onClick={() => approve(cfg.contracts.usdc, market.quoteSymbol)}>
              Approve {market.quoteSymbol}
            </button>
          ) : (
            <button
              className="btn btn-wide btn-buy"
              disabled={busy !== null || !ready || insufficient}
              onClick={onDeposit}
            >
              {insufficient ? "Insufficient balance" : "Add shadow liquidity"}
            </button>
          )}
        </>
      ) : (
        <>
          <div className="field">
            <span className="field-label">Withdraw {withdrawPct}% of your shares</span>
            <input
              type="range"
              min={0}
              max={100}
              value={withdrawPct}
              onChange={(e) => setWithdrawPct(Number(e.target.value))}
            />
          </div>
          <div className="quote-box num">
            <div className="qrow">
              <span className="dim">You receive</span>
              <span>
                {fmtAmount((myValue0 * BigInt(withdrawPct)) / 100n, 4, baseDec)} {market.baseSymbol} ·{" "}
                {fmtAmount((myValue1 * BigInt(withdrawPct)) / 100n, 2, quoteDec)} {market.quoteSymbol}
              </span>
            </div>
          </div>
          <button
            className="btn btn-wide btn-sell"
            disabled={busy !== null || shadow.myShares === 0n || withdrawPct === 0}
            onClick={onWithdraw}
          >
            {shadow.myShares === 0n ? "No shadow shares" : "Withdraw"}
          </button>
        </>
      )}
    </div>
  );
}
