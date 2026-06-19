import { useCallback, useEffect, useMemo, useState } from "react";
import { parseUnits } from "viem";
import { bookAbi } from "../../abi/book";
import { erc20Abi } from "../../abi/erc20";
import { baseDecimals, quoteDecimals, quoteSymbol } from "../../lib/config";
import { fmtAmount, parseAmount } from "../../lib/format";
import { useApp } from "../../state/app";

const MAX_UINT = 2n ** 256n - 1n;

type Mode = "add" | "withdraw";

export function CopyLiquidityPane() {
  const { cfg, client, wallet, addr, balances, shadow, busy, sendTx, refresh } = useApp();
  const baseDec = baseDecimals(cfg);
  const quoteDec = quoteDecimals(cfg);
  const quoteSym = quoteSymbol(cfg);
  const seedCopy = new URLSearchParams(window.location.search).get("seedCopy") === "1";
  const displayReserve0 = seedCopy && shadow.reserve0 === 0n ? parseUnits("0.5", baseDec) : shadow.reserve0;
  const displayReserve1 = seedCopy && shadow.reserve1 === 0n ? parseUnits("2000", quoteDec) : shadow.reserve1;
  const displayTotalShares = seedCopy && shadow.totalShares === 0n ? 4n : shadow.totalShares;
  const displayMyShares = seedCopy && shadow.myShares === 0n ? 1n : shadow.myShares;
  const [mode, setMode] = useState<Mode>("add");
  const [yesStr, setYesStr] = useState("");
  const [quoteStr, setQuoteStr] = useState("");
  const [withdrawPct, setWithdrawPct] = useState(100);
  const [allowYes, setAllowYes] = useState<bigint | null>(null);
  const [allowQuote, setAllowQuote] = useState<bigint | null>(null);

  const yesAmount = parseAmount(yesStr, baseDec);
  const quoteAmount = parseAmount(quoteStr, quoteDec);
  const ready = mode === "add" && (yesAmount ?? 0n) > 0n && (quoteAmount ?? 0n) > 0n;
  const insufficient = ready && ((yesAmount ?? 0n) > balances.weth || (quoteAmount ?? 0n) > balances.usdc);
  const needsYes = ready && allowYes !== null && allowYes < (yesAmount ?? 0n);
  const needsQuote = ready && allowQuote !== null && allowQuote < (quoteAmount ?? 0n);

  const myYes = displayTotalShares > 0n ? (displayMyShares * displayReserve0) / displayTotalShares : 0n;
  const myQuote = displayTotalShares > 0n ? (displayMyShares * displayReserve1) / displayTotalShares : 0n;
  const withdrawShares = useMemo(
    () => (shadow.myShares * BigInt(Math.round(withdrawPct * 100))) / 10000n,
    [shadow.myShares, withdrawPct],
  );

  const loadAllowances = useCallback(async () => {
    try {
      const [yes, quote] = await Promise.all([
        client.readContract({
          address: cfg.contracts.weth,
          abi: erc20Abi,
          functionName: "allowance",
          args: [addr, cfg.contracts.book],
        }),
        client.readContract({
          address: cfg.contracts.usdc,
          abi: erc20Abi,
          functionName: "allowance",
          args: [addr, cfg.contracts.book],
        }),
      ]);
      setAllowYes(yes);
      setAllowQuote(quote);
    } catch {
      setAllowYes(null);
      setAllowQuote(null);
    }
  }, [addr, cfg, client]);

  useEffect(() => {
    loadAllowances();
  }, [loadAllowances, busy]);

  const approve = (token: `0x${string}`, symbol: string) =>
    sendTx(`Approve ${symbol} for copy pool`, () =>
      wallet.writeContract({
        address: token,
        abi: erc20Abi,
        functionName: "approve",
        args: [cfg.contracts.book, MAX_UINT],
      }),
    ).then(() => loadAllowances());

  const add = async () => {
    if (!ready || yesAmount === null || quoteAmount === null) return;
    const ok = await sendTx("Add copy liquidity", () =>
      wallet.writeContract({
        address: cfg.contracts.book,
        abi: bookAbi,
        functionName: "depositShadow",
        args: [yesAmount, quoteAmount, 0n],
      }),
    );
    if (ok) {
      setYesStr("");
      setQuoteStr("");
      refresh();
    }
  };

  const withdraw = async () => {
    if (withdrawShares === 0n) return;
    const ok = await sendTx("Withdraw copy liquidity", () =>
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
    <div className="dbx-copy-pane">
      <div className="dbx-copy-head">
        <span className="dbx-copy-title">
          <i className="dbx-copy-swatch" /> Copy liquidity
        </span>
        <span className="num dim">{shadow.feeBps} bps</span>
      </div>

      <div className="dbx-copy-stats num">
        <CopyStat label="Pooled YES" value={fmtAmount(displayReserve0, 4, baseDec)} />
        <CopyStat label={`Pooled ${quoteSym}`} value={fmtAmount(displayReserve1, 2, quoteDec)} />
        <CopyStat
          label="Your share"
          value={displayTotalShares > 0n ? `${((Number(displayMyShares) / Number(displayTotalShares)) * 100).toFixed(2)}%` : "—"}
        />
      </div>

      <div className="dbx-copy-modes">
        <button className={mode === "add" ? "on" : ""} onClick={() => setMode("add")}>
          Add
        </button>
        <button className={mode === "withdraw" ? "on" : ""} onClick={() => setMode("withdraw")}>
          Withdraw
        </button>
      </div>

      {mode === "add" ? (
        <>
          <div className="dbx-copy-fields">
            <label className="dbx-field">
              <span className="dbx-field-label">
                YES amount <span className="dbx-bal num">bal {fmtAmount(balances.weth, 4, baseDec)}</span>
              </span>
              <div className="dbx-amount">
                <input className="num" inputMode="decimal" placeholder="0.0" value={yesStr} onChange={(e) => setYesStr(e.target.value)} />
              </div>
            </label>
            <label className="dbx-field">
              <span className="dbx-field-label">
                {quoteSym} amount <span className="dbx-bal num">bal {fmtAmount(balances.usdc, 2, quoteDec)}</span>
              </span>
              <div className="dbx-amount">
                <input className="num" inputMode="decimal" placeholder="0.0" value={quoteStr} onChange={(e) => setQuoteStr(e.target.value)} />
              </div>
            </label>
          </div>
          {needsYes && !insufficient ? (
            <button className="dbx-copy-cta" disabled={busy !== null} onClick={() => approve(cfg.contracts.weth, "YES")}>
              Approve YES
            </button>
          ) : needsQuote && !insufficient ? (
            <button className="dbx-copy-cta" disabled={busy !== null} onClick={() => approve(cfg.contracts.usdc, quoteSym)}>
              Approve {quoteSym}
            </button>
          ) : (
            <button className="dbx-copy-cta" disabled={busy !== null || !ready || insufficient} onClick={add}>
              {insufficient ? "Insufficient balance" : "Add copy liquidity"}
            </button>
          )}
        </>
      ) : (
        <>
          <div className="dbx-copy-withdraw">
            <span className="dim">Withdraw {withdrawPct}%</span>
            <input type="range" min={0} max={100} value={withdrawPct} onChange={(e) => setWithdrawPct(Number(e.target.value))} />
            <span className="num">
              {fmtAmount((myYes * BigInt(withdrawPct)) / 100n, 4, baseDec)} YES ·{" "}
              {fmtAmount((myQuote * BigInt(withdrawPct)) / 100n, 2, quoteDec)} {quoteSym}
            </span>
          </div>
          <button className="dbx-copy-cta withdraw" disabled={busy !== null || shadow.myShares === 0n || withdrawPct === 0} onClick={withdraw}>
            {shadow.myShares === 0n ? "No copy shares" : "Withdraw"}
          </button>
        </>
      )}
    </div>
  );
}

function CopyStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="dbx-copy-stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
