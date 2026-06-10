import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  decodeFunctionResult,
  encodeFunctionData,
  getAbiItem,
  parseUnits,
  type PrivateKeyAccount,
  type PublicClient,
} from "viem";
import type { DeploymentConfig } from "../lib/config";
import { isConfigured } from "../lib/config";
import { makePublicClient, makeWalletClient, type DemoWalletClient } from "../lib/chain";
import { ensureGas, loadOrCreateAccount } from "../lib/wallet";
import { bookAbi } from "../abi/book";
import { lensAbi } from "../abi/lens";
import { erc20Abi } from "../abi/erc20";
import { tickToPrice } from "../lib/format";

// ---------------------------------------------------------------- types

export interface BookSummary {
  currentTick: number;
  tickSpacing: number;
  bestAsk: number; // tick; may equal scan-window sentinel when book empty
  bestBid: number;
  hasAsk: boolean;
  hasBid: boolean;
}

export interface DepthLevel {
  tick: number;
  askSize: bigint;
  bidSize: bigint;
}

export interface Fill {
  key: string;
  time: number; // ms
  side: "buy" | "sell";
  priceLo: number;
  priceHi: number;
  size0: bigint; // token0 units
}

export interface PricePoint {
  t: number;
  price: number;
}

export interface PositionRow {
  id: bigint;
  isBid: boolean;
  lower: number;
  upper: number;
  liquidity: bigint;
  slope: bigint;
  live: boolean;
  claimable: bigint; // proceeds ready to claim
  unfilled: bigint; // resting principal
}

export interface Balances {
  eth: bigint;
  weth: bigint;
  usdc: bigint;
}

export interface TxToast {
  id: number;
  label: string;
  status: "pending" | "success" | "error";
  detail?: string;
}

interface AppData {
  cfg: DeploymentConfig;
  configured: boolean;
  client: PublicClient;
  wallet: DemoWalletClient;
  account: PrivateKeyAccount;
  summary: BookSummary | null;
  depth: DepthLevel[];
  fills: Fill[];
  priceHistory: PricePoint[];
  balances: Balances;
  positions: PositionRow[];
  rpcError: string | null;
  toasts: TxToast[];
  busy: string | null;
  sendTx: (label: string, fn: () => Promise<`0x${string}`>) => Promise<boolean>;
  faucet: () => Promise<void>;
  refresh: () => void;
}

const AppCtx = createContext<AppData | null>(null);

export function useApp(): AppData {
  const ctx = useContext(AppCtx);
  if (!ctx) throw new Error("useApp outside provider");
  return ctx;
}

// ---------------------------------------------------------------- events

const runFilledEvent = getAbiItem({ abi: bookAbi, name: "RunFilled" });
const intervalFilledEvent = getAbiItem({ abi: bookAbi, name: "IntervalFilled" });
const depositEvent = getAbiItem({ abi: bookAbi, name: "Deposit" });

const DEPTH_WINDOW = 8000; // ticks each side (shrinks adaptively if the node's eth_call gas cap is tight)
const MIN_DEPTH_WINDOW = 500;
const DEPTH_MAX_LEVELS = 60n;
const MAX_FILLS = 60;
const MAX_HISTORY = 1200;
/** The lens walks per-tick ledgers; ±8000 ticks needs ~80M gas, above many
 * nodes' default eth_call budget. An explicit gas field lifts it where the
 * node allows (anvil does); otherwise we fall back to a narrower window. */
const LENS_GAS_HINT = 1_000_000_000n;
const TICK_MAX = 8_388_607; // int24 sentinels used by lens.summary
const TICK_MIN = -8_388_608;

/** eth_call with an explicit gas field — viem's readContract typing omits
 * `gas`, but the per-tick lens scans need a raised budget on nodes that
 * allow it (devnets do). */
async function readSummary(client: PublicClient, lens: `0x${string}`, book: `0x${string}`, window: number) {
  const data = encodeFunctionData({ abi: lensAbi, functionName: "summary", args: [book, window] });
  const res = await client.call({ to: lens, data, gas: LENS_GAS_HINT });
  if (!res.data) throw new Error("lens.summary: empty result");
  return decodeFunctionResult({ abi: lensAbi, functionName: "summary", data: res.data });
}

async function readDepth(
  client: PublicClient,
  lens: `0x${string}`,
  book: `0x${string}`,
  fromTick: number,
  toTick: number,
  maxLevels: bigint,
) {
  const data = encodeFunctionData({
    abi: lensAbi,
    functionName: "depth",
    args: [book, fromTick, toTick, maxLevels],
  });
  const res = await client.call({ to: lens, data, gas: LENS_GAS_HINT });
  if (!res.data) throw new Error("lens.depth: empty result");
  return decodeFunctionResult({ abi: lensAbi, functionName: "depth", data: res.data });
}

// ---------------------------------------------------------------- provider

export function AppProvider({ cfg, children }: { cfg: DeploymentConfig; children: ReactNode }) {
  const configured = useMemo(() => isConfigured(cfg), [cfg]);
  const client = useMemo(() => makePublicClient(cfg), [cfg]);
  const account = useMemo(() => loadOrCreateAccount(), []);
  const wallet = useMemo(() => makeWalletClient(cfg, account), [cfg, account]);

  const [summary, setSummary] = useState<BookSummary | null>(null);
  const [depth, setDepth] = useState<DepthLevel[]>([]);
  const [fills, setFills] = useState<Fill[]>([]);
  const [priceHistory, setPriceHistory] = useState<PricePoint[]>([]);
  const [balances, setBalances] = useState<Balances>({ eth: 0n, weth: 0n, usdc: 0n });
  const [positions, setPositions] = useState<PositionRow[]>([]);
  const [rpcError, setRpcError] = useState<string | null>(null);
  const [toasts, setToasts] = useState<TxToast[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0); // manual refresh trigger

  const summaryRef = useRef<BookSummary | null>(null);
  summaryRef.current = summary;
  const errCount = useRef(0);

  const noteError = useCallback((e: unknown) => {
    errCount.current += 1;
    if (errCount.current >= 2) {
      const msg = e instanceof Error ? e.message.split("\n")[0] : String(e);
      setRpcError(msg.length > 120 ? msg.slice(0, 120) + "…" : msg);
    }
  }, []);

  const noteOk = useCallback(() => {
    errCount.current = 0;
    setRpcError(null);
  }, []);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  // -------- gas top-up on wallet creation
  useEffect(() => {
    if (!configured) return;
    ensureGas(client, cfg, account.address).catch(() => {
      /* devnet faucet unavailable — surfaced via balance display */
    });
  }, [configured, client, cfg, account]);

  // -------- summary + depth + price history (2s)
  const windowRef = useRef(DEPTH_WINDOW);
  useEffect(() => {
    if (!configured) return;
    let stop = false;
    let inflight = false;
    const tick = async () => {
      if (inflight || stop) return;
      inflight = true;
      try {
        let s;
        // adaptive scan window: shrink on eth_call gas-cap failures
        for (;;) {
          try {
            s = await readSummary(client, cfg.contracts.lens, cfg.contracts.book, windowRef.current);
            break;
          } catch (e) {
            if (windowRef.current <= MIN_DEPTH_WINDOW) throw e;
            windowRef.current = Math.max(MIN_DEPTH_WINDOW, Math.floor(windowRef.current / 2));
          }
        }
        const win = windowRef.current;
        const cur = Number(s.currentTick);
        const bestAsk = Number(s.bestAsk);
        const bestBid = Number(s.bestBid);
        const sum: BookSummary = {
          currentTick: cur,
          tickSpacing: Number(s.tickSpacing),
          bestAsk,
          bestBid,
          hasAsk: bestAsk !== TICK_MAX && bestAsk > cur,
          hasBid: bestBid !== TICK_MIN && bestBid <= cur,
        };
        // query each side separately — with thin ticks a single call's
        // maxLevels budget is consumed entirely by the ask side
        const [askLevels, bidLevels] = await Promise.all([
          readDepth(client, cfg.contracts.lens, cfg.contracts.book, cur, cur + win, DEPTH_MAX_LEVELS),
          readDepth(client, cfg.contracts.lens, cfg.contracts.book, cur - win, cur, DEPTH_MAX_LEVELS),
        ]);
        if (stop) return;
        setSummary(sum);
        const merged = new Map<number, DepthLevel>();
        for (const l of askLevels) {
          if (l.askSize > 0n) {
            merged.set(Number(l.tick), { tick: Number(l.tick), askSize: l.askSize, bidSize: 0n });
          }
        }
        for (const l of bidLevels) {
          if (l.bidSize > 0n) {
            const t = Number(l.tick);
            const prev = merged.get(t);
            merged.set(t, { tick: t, askSize: prev?.askSize ?? 0n, bidSize: l.bidSize });
          }
        }
        setDepth([...merged.values()]);
        setPriceHistory((h) => {
          const next = [...h, { t: Date.now(), price: tickToPrice(cur) }];
          return next.length > MAX_HISTORY ? next.slice(next.length - MAX_HISTORY) : next;
        });
        noteOk();
      } catch (e) {
        if (!stop) noteError(e);
      } finally {
        inflight = false;
      }
    };
    tick();
    const id = setInterval(tick, 2000);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [configured, client, cfg, noteError, noteOk]);

  // -------- fills feed via log polling (2.5s)
  useEffect(() => {
    if (!configured) return;
    let stop = false;
    let inflight = false;
    let from: bigint | null = null;
    const tick = async () => {
      if (inflight || stop) return;
      inflight = true;
      try {
        const latest = await client.getBlockNumber();
        if (from === null) {
          from = latest > 2000n ? latest - 2000n : 0n;
        }
        if (latest < from) {
          inflight = false;
          return;
        }
        const logs = await client.getLogs({
          address: cfg.contracts.book,
          events: [runFilledEvent, intervalFilledEvent],
          fromBlock: from,
          toBlock: latest,
        });
        from = latest + 1n;
        if (stop || logs.length === 0) {
          inflight = false;
          return;
        }
        const spacing = summaryRef.current?.tickSpacing ?? 1;
        const now = Date.now();
        const parsed: Fill[] = [];
        for (const log of logs) {
          if (log.eventName === "RunFilled") {
            const a = log.args as {
              fromLevel?: number;
              toBoundary?: number;
              startSize?: bigint;
              slopePerLevel?: bigint;
            };
            if (a.fromLevel === undefined || a.toBoundary === undefined) continue;
            const lo = Number(a.fromLevel);
            const hi = Number(a.toBoundary);
            const n = BigInt(Math.max(1, Math.round((hi - lo) / spacing)));
            const start = a.startSize ?? 0n;
            const slope = a.slopePerLevel ?? 0n;
            let size = start * n + (slope * n * (n - 1n)) / 2n;
            if (size < 0n) size = 0n;
            parsed.push({
              key: `${log.blockNumber}-${log.logIndex}`,
              time: now,
              side: "buy", // upward run: taker bought token0 through asks
              priceLo: tickToPrice(lo),
              priceHi: tickToPrice(hi),
              size0: size,
            });
          } else {
            const a = log.args as { lowerTick?: number; liquidity?: bigint };
            if (a.lowerTick === undefined) continue;
            const lo = Number(a.lowerTick);
            parsed.push({
              key: `${log.blockNumber}-${log.logIndex}`,
              time: now,
              side: "sell", // bid interval filled: taker sold token0 into bids
              priceLo: tickToPrice(lo),
              priceHi: tickToPrice(lo + spacing),
              size0: a.liquidity ?? 0n,
            });
          }
        }
        if (parsed.length > 0) {
          setFills((f) => [...parsed.reverse(), ...f].slice(0, MAX_FILLS));
        }
        noteOk();
      } catch (e) {
        if (!stop) noteError(e);
      } finally {
        inflight = false;
      }
    };
    tick();
    const id = setInterval(tick, 2500);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [configured, client, cfg, noteError, noteOk]);

  // -------- balances (3s + manual)
  useEffect(() => {
    if (!configured) return;
    let stop = false;
    const tick = async () => {
      try {
        const [eth, weth, usdc] = await Promise.all([
          client.getBalance({ address: account.address }),
          client.readContract({
            address: cfg.contracts.weth,
            abi: erc20Abi,
            functionName: "balanceOf",
            args: [account.address],
          }),
          client.readContract({
            address: cfg.contracts.usdc,
            abi: erc20Abi,
            functionName: "balanceOf",
            args: [account.address],
          }),
        ]);
        if (!stop) setBalances({ eth, weth, usdc });
      } catch {
        /* covered by main poll's error banner */
      }
    };
    tick();
    const id = setInterval(tick, 3000);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [configured, client, cfg, account, nonce]);

  // -------- positions: Deposit logs (owner-filtered) + per-id state (3s)
  const knownIds = useRef<Set<bigint>>(new Set());
  const depositScanFrom = useRef<bigint>(0n);
  useEffect(() => {
    if (!configured) return;
    let stop = false;
    let inflight = false;
    const tick = async () => {
      if (inflight || stop) return;
      inflight = true;
      try {
        const latest = await client.getBlockNumber();
        if (latest >= depositScanFrom.current) {
          const logs = await client.getLogs({
            address: cfg.contracts.book,
            event: depositEvent,
            args: { owner: account.address },
            fromBlock: depositScanFrom.current,
            toBlock: latest,
          });
          depositScanFrom.current = latest + 1n;
          for (const log of logs) {
            const id = (log.args as { positionId?: bigint }).positionId;
            if (id !== undefined) knownIds.current.add(id);
          }
        }
        const ids = [...knownIds.current];
        const rows = await Promise.all(
          ids.map(async (id): Promise<PositionRow | null> => {
            const p = await client.readContract({
              address: cfg.contracts.book,
              abi: bookAbi,
              functionName: "positions",
              args: [id],
            });
            const [owner, lower, upper, liquidity, slope, , , live, isBid] = p;
            if (owner.toLowerCase() !== account.address.toLowerCase()) return null;
            let claimable = 0n;
            let unfilled = 0n;
            if (live) {
              try {
                [claimable, unfilled] = await Promise.all([
                  client.readContract({
                    address: cfg.contracts.book,
                    abi: bookAbi,
                    functionName: isBid ? "bidClaimable" : "claimable",
                    args: [id],
                  }),
                  isBid
                    ? client.readContract({
                        address: cfg.contracts.book,
                        abi: bookAbi,
                        functionName: "bidRefundable",
                        args: [id],
                      })
                    : client.readContract({
                        address: cfg.contracts.book,
                        abi: bookAbi,
                        functionName: "unfilledPrincipal",
                        args: [id],
                      }),
                ]);
              } catch {
                /* keep zeros if a view reverts mid-fill */
              }
            }
            return {
              id,
              isBid,
              lower: Number(lower),
              upper: Number(upper),
              liquidity,
              slope: BigInt(slope),
              live,
              claimable,
              unfilled,
            };
          }),
        );
        if (!stop) {
          setPositions(
            rows
              .filter((r): r is PositionRow => r !== null)
              .sort((a, b) => (a.id < b.id ? 1 : -1)),
          );
        }
      } catch {
        /* covered by main poll's error banner */
      } finally {
        inflight = false;
      }
    };
    tick();
    const id = setInterval(tick, 3000);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [configured, client, cfg, account, nonce]);

  // -------- tx pipeline
  const toastSeq = useRef(0);
  const pushToast = useCallback((t: Omit<TxToast, "id">) => {
    const id = ++toastSeq.current;
    setToasts((x) => [...x, { ...t, id }]);
    if (t.status !== "pending") {
      setTimeout(() => setToasts((x) => x.filter((y) => y.id !== id)), 6000);
    }
    return id;
  }, []);

  const sendTx = useCallback(
    async (label: string, fn: () => Promise<`0x${string}`>): Promise<boolean> => {
      setBusy(label);
      const pendingId = pushToast({ label, status: "pending" });
      try {
        const hash = await fn();
        const receipt = await client.waitForTransactionReceipt({ hash, timeout: 30_000 });
        setToasts((x) => x.filter((y) => y.id !== pendingId));
        if (receipt.status === "success") {
          pushToast({ label, status: "success", detail: hash.slice(0, 14) + "…" });
          refresh();
          return true;
        }
        pushToast({ label, status: "error", detail: "transaction reverted" });
        return false;
      } catch (e) {
        setToasts((x) => x.filter((y) => y.id !== pendingId));
        let msg = e instanceof Error ? e.message.split("\n")[0] : String(e);
        if (msg.length > 100) msg = msg.slice(0, 100) + "…";
        pushToast({ label, status: "error", detail: msg });
        return false;
      } finally {
        setBusy(null);
      }
    },
    [client, pushToast, refresh],
  );

  // -------- faucet: gas + 10 WETH + 50,000 USDC
  const faucet = useCallback(async () => {
    try {
      await ensureGas(client, cfg, account.address);
    } catch {
      /* may already have gas */
    }
    const okWeth = await sendTx("Faucet: mint 10 WETH", () =>
      wallet.writeContract({
        address: cfg.contracts.weth,
        abi: erc20Abi,
        functionName: "mint",
        args: [account.address, parseUnits("10", 18)],
      }),
    );
    if (!okWeth) return;
    await sendTx("Faucet: mint 50,000 USDC", () =>
      wallet.writeContract({
        address: cfg.contracts.usdc,
        abi: erc20Abi,
        functionName: "mint",
        args: [account.address, parseUnits("50000", 18)],
      }),
    );
  }, [client, cfg, account, wallet, sendTx]);

  const value: AppData = {
    cfg,
    configured,
    client,
    wallet,
    account,
    summary,
    depth,
    fills,
    priceHistory,
    balances,
    positions,
    rpcError,
    toasts,
    busy,
    sendTx,
    faucet,
    refresh,
  };

  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}
