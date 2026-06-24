import { useCallback, useEffect, useMemo, useState } from "react";
import { parseUnits } from "viem";
import { bookAbi } from "../../abi/book";
import { erc20Abi } from "../../abi/erc20";
import { routerAbi } from "../../abi/router";
import { baseDecimals, quoteDecimals, quoteSymbol } from "../../lib/config";
import { fmtAmount, parseAmount } from "../../lib/format";
import { useApp } from "../../state/app";

const MAX_UINT = 2n ** 256n - 1n;

type Mode = "add" | "withdraw";

interface CopyPool {
  reserve0: bigint;
  reserve1: bigint;
  totalShares: bigint;
  myShares: bigint;
  feeBps: number;
}

interface ZapPreview {
  amount0In: bigint;
  amount1In: bigint;
  swapped0For1: boolean;
  swapIn: bigint;
  swapOut: bigint;
  amount0Deposited: bigint;
  amount1Deposited: bigint;
  shares: bigint;
  refund0: bigint;
  refund1: bigint;
}

export function CopyLiquidityPane({
  bookAddress,
  outcomeSymbol = "YES",
  outcomeToken,
  outcomeBalance,
}: {
  bookAddress?: `0x${string}`;
  outcomeSymbol?: string;
  outcomeToken?: `0x${string}`;
  outcomeBalance?: bigint;
}) {
  const { cfg, client, wallet, addr, balances, busy, sendTx, refresh } = useApp();
  const baseDec = baseDecimals(cfg);
  const quoteDec = quoteDecimals(cfg);
  const quoteSym = quoteSymbol(cfg);
  const book = bookAddress ?? cfg.contracts.book;
  const token = outcomeToken ?? cfg.contracts.weth;
  const tokenBalance = outcomeBalance ?? balances.weth;
  const [pool, setPool] = useState<CopyPool>({
    reserve0: 0n,
    reserve1: 0n,
    totalShares: 0n,
    myShares: 0n,
    feeBps: 30,
  });
  const seedCopy = new URLSearchParams(window.location.search).get("seedCopy") === "1";
  const displayReserve0 = seedCopy && pool.reserve0 === 0n ? parseUnits("0.5", baseDec) : pool.reserve0;
  const displayReserve1 = seedCopy && pool.reserve1 === 0n ? parseUnits("2000", quoteDec) : pool.reserve1;
  const displayTotalShares = seedCopy && pool.totalShares === 0n ? 4n : pool.totalShares;
  const displayMyShares = seedCopy && pool.myShares === 0n ? 1n : pool.myShares;
  const [mode, setMode] = useState<Mode>("add");
  const [yesStr, setYesStr] = useState("");
  const [quoteStr, setQuoteStr] = useState("");
  const [withdrawPct, setWithdrawPct] = useState(100);
  const [allowYes, setAllowYes] = useState<bigint | null>(null);
  const [allowQuote, setAllowQuote] = useState<bigint | null>(null);
  const [zapPreview, setZapPreview] = useState<ZapPreview | null>(null);
  const [previewErr, setPreviewErr] = useState<string | null>(null);
  const [slippageBps, setSlippageBps] = useState(100);

  const yesAmount = parseAmount(yesStr, baseDec);
  const quoteAmount = parseAmount(quoteStr, quoteDec);
  const ready = mode === "add" && ((yesAmount ?? 0n) > 0n || (quoteAmount ?? 0n) > 0n);
  const insufficient = ready && ((yesAmount ?? 0n) > tokenBalance || (quoteAmount ?? 0n) > balances.usdc);
  const needsYes = ready && (yesAmount ?? 0n) > 0n && allowYes !== null && allowYes < (yesAmount ?? 0n);
  const needsQuote = ready && (quoteAmount ?? 0n) > 0n && allowQuote !== null && allowQuote < (quoteAmount ?? 0n);
  const guarded = useCallback((amount: bigint) => (amount * BigInt(10_000 - slippageBps)) / 10_000n, [slippageBps]);
  const minSharesOut = zapPreview ? guarded(zapPreview.shares) : 0n;
  const minSwapOut = zapPreview && zapPreview.swapOut > 0n ? guarded(zapPreview.swapOut) : 0n;

  const myYes = displayTotalShares > 0n ? (displayMyShares * displayReserve0) / displayTotalShares : 0n;
  const myQuote = displayTotalShares > 0n ? (displayMyShares * displayReserve1) / displayTotalShares : 0n;
  const withdrawShares = useMemo(
    () => (pool.myShares * BigInt(Math.round(withdrawPct * 100))) / 10000n,
    [pool.myShares, withdrawPct],
  );

  const loadPool = useCallback(async () => {
    try {
      const [reserves, myShares] = await Promise.all([
        client.readContract({
          address: book,
          abi: bookAbi,
          functionName: "shadowReserves",
        }),
        client.readContract({
          address: book,
          abi: bookAbi,
          functionName: "shadowSharesOf",
          args: [addr],
        }),
      ]);
      setPool({
        reserve0: reserves[0],
        reserve1: reserves[1],
        totalShares: reserves[2],
        myShares,
        feeBps: 30,
      });
    } catch {
      setPool((prev) => ({ ...prev, reserve0: 0n, reserve1: 0n, totalShares: 0n, myShares: 0n }));
    }
  }, [addr, book, client]);

  const loadAllowances = useCallback(async () => {
    try {
      const [yes, quote] = await Promise.all([
        client.readContract({
          address: token,
          abi: erc20Abi,
          functionName: "allowance",
          args: [addr, cfg.contracts.router],
        }),
        client.readContract({
          address: cfg.contracts.usdc,
          abi: erc20Abi,
          functionName: "allowance",
          args: [addr, cfg.contracts.router],
        }),
      ]);
      setAllowYes(yes);
      setAllowQuote(quote);
    } catch {
      setAllowYes(null);
      setAllowQuote(null);
    }
  }, [addr, cfg.contracts.router, cfg.contracts.usdc, client, token]);

  useEffect(() => {
    loadPool();
    loadAllowances();
  }, [loadAllowances, loadPool, busy]);

  useEffect(() => {
    if (!ready || yesAmount === null || quoteAmount === null) {
      setZapPreview(null);
      setPreviewErr(null);
      return;
    }
    let stop = false;
    client
      .readContract({
        address: cfg.contracts.router,
        abi: routerAbi,
        functionName: "previewZapDepositShadow",
        args: [book, yesAmount, quoteAmount],
      })
      .then((result) => {
        if (!stop) {
          setZapPreview(normalizeZapPreview(result));
          setPreviewErr(null);
        }
      })
      .catch((e) => {
        if (!stop) {
          setZapPreview(null);
          setPreviewErr(e instanceof Error ? e.message.split("\n")[0] : "Preview unavailable");
        }
      });
    return () => {
      stop = true;
    };
  }, [book, cfg.contracts.router, client, quoteAmount, ready, yesAmount, busy]);

  const approve = (token: `0x${string}`, symbol: string) =>
    sendTx(`Approve ${symbol} for auto-balance`, () =>
      wallet.writeContract({
        address: token,
        abi: erc20Abi,
        functionName: "approve",
        args: [cfg.contracts.router, MAX_UINT],
      }),
    ).then(() => loadAllowances());

  const add = async () => {
    if (!ready || yesAmount === null || quoteAmount === null || !zapPreview || zapPreview.shares === 0n) return;
    const { timestamp } = await client.getBlock({ blockTag: "latest" });
    const deadline = timestamp + 600n;
    const ok = await sendTx("Auto-balance copy liquidity", () =>
      wallet.writeContract({
        address: cfg.contracts.router,
        abi: routerAbi,
        functionName: "zapDepositShadow",
        args: [book, yesAmount, quoteAmount, minSwapOut, minSharesOut, addr, deadline],
      }),
    );
    if (ok) {
      setYesStr("");
      setQuoteStr("");
      loadPool();
      refresh();
    }
  };

  const withdraw = async () => {
    if (withdrawShares === 0n) return;
    const ok = await sendTx("Withdraw copy liquidity", () =>
      wallet.writeContract({
        address: book,
        abi: bookAbi,
        functionName: "withdrawShadow",
        args: [withdrawShares, 0n, 0n],
      }),
    );
    if (ok) {
      loadPool();
      refresh();
    }
  };

  const swapFromSymbol = zapPreview?.swapped0For1 ? outcomeSymbol : quoteSym;
  const swapToSymbol = zapPreview?.swapped0For1 ? quoteSym : outcomeSymbol;
  const swapFromDec = zapPreview?.swapped0For1 ? baseDec : quoteDec;
  const swapToDec = zapPreview?.swapped0For1 ? quoteDec : baseDec;
  const hasRefund = !!zapPreview && (zapPreview.refund0 > 0n || zapPreview.refund1 > 0n);
  const addDisabled = busy !== null || !ready || insufficient || !zapPreview || zapPreview.shares === 0n;
  const addLabel = insufficient
    ? "Insufficient balance"
    : previewErr
      ? "Preview unavailable"
      : zapPreview?.shares === 0n
        ? "No depositable amount"
        : "Auto-balance into pool";

  return (
    <div className="dbx-copy-pane">
      <div className="dbx-copy-head">
        <span className="dbx-copy-title">
          <i className="dbx-copy-swatch" /> Copy liquidity
        </span>
        <span className="num dim">{pool.feeBps} bps</span>
      </div>

      <div className="dbx-copy-stats num">
        <CopyStat label={`Pooled ${outcomeSymbol}`} value={fmtAmount(displayReserve0, 4, baseDec)} />
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
                {outcomeSymbol} amount <span className="dbx-bal num">bal {fmtAmount(tokenBalance, 4, baseDec)}</span>
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
          <div className="dbx-copy-preview">
            <div className="dbx-copy-preview-head">
              <span>Auto-balance into pool ratio</span>
              <label className="dbx-slip num">
                <span>Slippage</span>
                <input
                  type="number"
                  min={0}
                  max={50}
                  step={0.1}
                  value={slippageBps / 100}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    if (Number.isFinite(n)) setSlippageBps(Math.max(0, Math.min(5000, Math.round(n * 100))));
                  }}
                />
                <span>%</span>
              </label>
            </div>
            {previewErr ? (
              <div className="dbx-copy-line warn">Preview unavailable on this deployment.</div>
            ) : !ready ? (
              <div className="dbx-copy-line dim">Enter either side to preview the deposit.</div>
            ) : zapPreview ? (
              <>
                {pool.totalShares === 0n ? (
                  <div className="dbx-copy-line dim">First deposit sets the copy-pool ratio. No rebalance swap is used.</div>
                ) : zapPreview.swapOut > 0n ? (
                  <div className="dbx-copy-line">
                    <span>Rebalance</span>
                    <strong className="num">
                      {fmtAmount(zapPreview.swapIn, 4, swapFromDec)} {swapFromSymbol} →{" "}
                      {fmtAmount(zapPreview.swapOut, 4, swapToDec)} {swapToSymbol}
                    </strong>
                  </div>
                ) : (
                  <div className="dbx-copy-line dim">No rebalance swap expected.</div>
                )}
                <div className="dbx-copy-line">
                  <span>Deposit</span>
                  <strong className="num">
                    {fmtAmount(zapPreview.amount0Deposited, 4, baseDec)} {outcomeSymbol} ·{" "}
                    {fmtAmount(zapPreview.amount1Deposited, 2, quoteDec)} {quoteSym}
                  </strong>
                </div>
                <div className="dbx-copy-line">
                  <span>Estimated shares</span>
                  <strong className="num">{fmtAmount(zapPreview.shares, 4, baseDec)}</strong>
                </div>
                {hasRefund && (
                  <div className="dbx-copy-line dim">
                    <span>Unused</span>
                    <strong className="num">
                      {fmtAmount(zapPreview.refund0, 4, baseDec)} {outcomeSymbol} ·{" "}
                      {fmtAmount(zapPreview.refund1, 2, quoteDec)} {quoteSym}
                    </strong>
                  </div>
                )}
                <div className="dbx-copy-line dim">
                  <span>Guard</span>
                  <strong className="num">
                    min {fmtAmount(minSharesOut, 4, baseDec)} shares
                    {minSwapOut > 0n ? ` · min swap ${fmtAmount(minSwapOut, 4, swapToDec)} ${swapToSymbol}` : ""}
                  </strong>
                </div>
              </>
            ) : (
              <div className="dbx-copy-line dim">Loading preview...</div>
            )}
          </div>
          {needsYes && !insufficient ? (
            <button className="dbx-copy-cta" disabled={busy !== null} onClick={() => approve(token, outcomeSymbol)}>
              Approve {outcomeSymbol}
            </button>
          ) : needsQuote && !insufficient ? (
            <button className="dbx-copy-cta" disabled={busy !== null} onClick={() => approve(cfg.contracts.usdc, quoteSym)}>
              Approve {quoteSym}
            </button>
          ) : (
            <button className="dbx-copy-cta" disabled={addDisabled} onClick={add}>
              {addLabel}
            </button>
          )}
        </>
      ) : (
        <>
          <div className="dbx-copy-withdraw">
            <span className="dim">Withdraw {withdrawPct}%</span>
            <input type="range" min={0} max={100} value={withdrawPct} onChange={(e) => setWithdrawPct(Number(e.target.value))} />
            <span className="num">
              {fmtAmount((myYes * BigInt(withdrawPct)) / 100n, 4, baseDec)} {outcomeSymbol} ·{" "}
              {fmtAmount((myQuote * BigInt(withdrawPct)) / 100n, 2, quoteDec)} {quoteSym}
            </span>
          </div>
          <button className="dbx-copy-cta withdraw" disabled={busy !== null || pool.myShares === 0n || withdrawPct === 0} onClick={withdraw}>
            {pool.myShares === 0n ? "No copy shares" : "Withdraw"}
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

function normalizeZapPreview(result: unknown): ZapPreview {
  const r = result as Record<string, unknown> & readonly unknown[];
  const bi = (key: keyof ZapPreview, index: number) => (r[key] ?? r[index] ?? 0n) as bigint;
  return {
    amount0In: bi("amount0In", 0),
    amount1In: bi("amount1In", 1),
    swapped0For1: (r.swapped0For1 ?? r[2] ?? false) as boolean,
    swapIn: bi("swapIn", 3),
    swapOut: bi("swapOut", 4),
    amount0Deposited: bi("amount0Deposited", 5),
    amount1Deposited: bi("amount1Deposited", 6),
    shares: bi("shares", 7),
    refund0: bi("refund0", 8),
    refund1: bi("refund1", 9),
  };
}
