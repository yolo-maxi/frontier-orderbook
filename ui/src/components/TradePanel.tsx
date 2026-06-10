import { useCallback, useEffect, useMemo, useState } from "react";
import { useApp } from "../state/app";
import { lensAbi } from "../abi/lens";
import { erc20Abi } from "../abi/erc20";
import { routerAbi } from "../abi/router";
import { fmtAmount, fmtPrice, parseAmount, tickToPrice } from "../lib/format";

type Side = "buy" | "sell";

interface Quote {
  out: bigint;
  spent: bigint;
  endTick: number;
}

const SLIPPAGE_OPTS = [0.1, 0.5, 1.0];
const MAX_UINT = 2n ** 256n - 1n;
const QUOTE_MAX_LEVELS = 500n;

export function TradePanel() {
  const { cfg, client, wallet, account, summary, balances, sendTx, busy, refresh } = useApp();
  const [side, setSide] = useState<Side>("buy");
  const [amountStr, setAmountStr] = useState("");
  const [slippage, setSlippage] = useState(0.5);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteErr, setQuoteErr] = useState<string | null>(null);
  const [allowance, setAllowance] = useState<bigint | null>(null);

  const amountIn = parseAmount(amountStr);
  const tokenIn = side === "buy" ? cfg.contracts.usdc : cfg.contracts.weth;
  const tokenOut = side === "buy" ? cfg.contracts.weth : cfg.contracts.usdc;
  const balanceIn = side === "buy" ? balances.usdc : balances.weth;

  // ---- live quote (debounced + refreshed)
  useEffect(() => {
    let stop = false;
    if (amountIn === null || amountIn === 0n) {
      setQuote(null);
      setQuoteErr(null);
      return;
    }
    const run = async () => {
      try {
        if (side === "buy") {
          const [out, spent, endTick] = await client.readContract({
            address: cfg.contracts.lens,
            abi: lensAbi,
            functionName: "quoteBuy",
            args: [cfg.contracts.book, amountIn],
          });
          if (!stop) {
            setQuote({ out, spent, endTick: Number(endTick) });
            setQuoteErr(null);
          }
        } else {
          const [out, spent, endTick] = await client.readContract({
            address: cfg.contracts.lens,
            abi: lensAbi,
            functionName: "quoteSell",
            args: [cfg.contracts.book, amountIn, QUOTE_MAX_LEVELS],
          });
          if (!stop) {
            setQuote({ out, spent, endTick: Number(endTick) });
            setQuoteErr(null);
          }
        }
      } catch (e) {
        if (!stop) {
          setQuote(null);
          setQuoteErr(e instanceof Error ? e.message.split("\n")[0] : "quote failed");
        }
      }
    };
    const t = setTimeout(run, 250);
    const iv = setInterval(run, 2000);
    return () => {
      stop = true;
      clearTimeout(t);
      clearInterval(iv);
    };
  }, [client, cfg, side, amountIn?.toString()]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- allowance for router
  const loadAllowance = useCallback(async () => {
    try {
      const a = await client.readContract({
        address: tokenIn,
        abi: erc20Abi,
        functionName: "allowance",
        args: [account.address, cfg.contracts.router],
      });
      setAllowance(a);
    } catch {
      setAllowance(null);
    }
  }, [client, tokenIn, account, cfg]);

  useEffect(() => {
    setAllowance(null);
    loadAllowance();
  }, [loadAllowance, busy]);

  const mid = summary ? tickToPrice(summary.currentTick) : null;

  const derived = useMemo(() => {
    if (!quote || amountIn === null || amountIn === 0n || quote.out === 0n) return null;
    const inF = Number(quote.spent) / 1e18;
    const outF = Number(quote.out) / 1e18;
    const avgPrice = side === "buy" ? inF / outF : outF / inF;
    const impact =
      mid !== null && mid > 0
        ? side === "buy"
          ? (avgPrice / mid - 1) * 100
          : (1 - avgPrice / mid) * 100
        : null;
    const minOut = (quote.out * BigInt(Math.round((100 - slippage) * 1000))) / 100_000n;
    const partial = quote.spent < amountIn;
    return { avgPrice, impact, minOut, partial, endPrice: tickToPrice(quote.endTick) };
  }, [quote, amountIn, side, mid, slippage]);

  const needsApproval =
    allowance !== null && amountIn !== null && amountIn > 0n && allowance < amountIn;
  const insufficient = amountIn !== null && amountIn > balanceIn;

  const onApprove = () =>
    sendTx(`Approve ${side === "buy" ? "USDC" : "WETH"}`, () =>
      wallet.writeContract({
        address: tokenIn,
        abi: erc20Abi,
        functionName: "approve",
        args: [cfg.contracts.router, MAX_UINT],
      }),
    ).then(() => loadAllowance());

  const onSwap = async () => {
    if (amountIn === null || derived === null) return;
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
    const ok = await sendTx(
      side === "buy" ? "Market buy WETH" : "Market sell WETH",
      () =>
        wallet.writeContract({
          address: cfg.contracts.router,
          abi: routerAbi,
          functionName: "swapExactTokensForTokens",
          args: [amountIn, derived.minOut, [tokenIn, tokenOut], account.address, deadline],
        }),
    );
    if (ok) {
      setAmountStr("");
      refresh();
    }
  };

  const setPct = (pct: number) => {
    const v = (balanceIn * BigInt(pct)) / 100n;
    setAmountStr((Number(v) / 1e18).toString());
  };

  return (
    <div className="trade-panel">
      <div className="seg">
        <button
          className={`seg-btn ${side === "buy" ? "seg-buy" : ""}`}
          onClick={() => {
            setSide("buy");
            setAmountStr("");
          }}
        >
          Buy WETH
        </button>
        <button
          className={`seg-btn ${side === "sell" ? "seg-sell" : ""}`}
          onClick={() => {
            setSide("sell");
            setAmountStr("");
          }}
        >
          Sell WETH
        </button>
      </div>

      <label className="field">
        <span className="field-label">
          Spend <span className="dim">({side === "buy" ? "USDC" : "WETH"})</span>
          <span className="field-bal num" onClick={() => setPct(100)}>
            bal {fmtAmount(balanceIn, side === "buy" ? 2 : 4)}
          </span>
        </span>
        <input
          className="input num"
          inputMode="decimal"
          placeholder="0.00"
          value={amountStr}
          onChange={(e) => setAmountStr(e.target.value)}
        />
        <div className="pct-row">
          {[25, 50, 75, 100].map((p) => (
            <button key={p} className="pct-btn" onClick={() => setPct(p)}>
              {p}%
            </button>
          ))}
        </div>
      </label>

      <div className="quote-box num">
        <div className="qrow">
          <span className="dim">Receive (est.)</span>
          <span>
            {quote ? fmtAmount(quote.out, side === "buy" ? 5 : 2) : "—"}{" "}
            <span className="dim">{side === "buy" ? "WETH" : "USDC"}</span>
          </span>
        </div>
        <div className="qrow">
          <span className="dim">Avg. price</span>
          <span>{derived ? fmtPrice(derived.avgPrice, 3) : "—"}</span>
        </div>
        <div className="qrow">
          <span className="dim">Price impact</span>
          <span className={derived?.impact != null && derived.impact > 1 ? "warn" : ""}>
            {derived?.impact != null ? `${derived.impact >= 0 ? "" : "−"}${Math.abs(derived.impact).toFixed(3)}%` : "—"}
          </span>
        </div>
        <div className="qrow">
          <span className="dim">End price</span>
          <span>{derived ? fmtPrice(derived.endPrice, 3) : "—"}</span>
        </div>
        <div className="qrow">
          <span className="dim">Min received</span>
          <span>{derived ? fmtAmount(derived.minOut, side === "buy" ? 5 : 2) : "—"}</span>
        </div>
        <div className="qrow">
          <span className="dim">Slippage</span>
          <span className="slip-opts">
            {SLIPPAGE_OPTS.map((s) => (
              <button
                key={s}
                className={`slip-btn ${slippage === s ? "slip-on" : ""}`}
                onClick={() => setSlippage(s)}
              >
                {s}%
              </button>
            ))}
          </span>
        </div>
      </div>

      {derived?.partial && (
        <div className="note warn">
          Book depth covers only {fmtAmount(quote!.spent, 2)} of your input — the remainder
          stays in your wallet.
        </div>
      )}
      {quoteErr && amountIn !== null && amountIn > 0n && (
        <div className="note warn">Quote unavailable: {quoteErr}</div>
      )}

      {needsApproval ? (
        <button
          className="btn btn-wide btn-accent"
          disabled={busy !== null || insufficient}
          onClick={onApprove}
        >
          Approve {side === "buy" ? "USDC" : "WETH"}
        </button>
      ) : (
        <button
          className={`btn btn-wide ${side === "buy" ? "btn-buy" : "btn-sell"}`}
          disabled={
            busy !== null ||
            amountIn === null ||
            amountIn === 0n ||
            insufficient ||
            derived === null
          }
          onClick={onSwap}
        >
          {insufficient
            ? "Insufficient balance"
            : side === "buy"
              ? "Buy WETH"
              : "Sell WETH"}
        </button>
      )}
    </div>
  );
}
