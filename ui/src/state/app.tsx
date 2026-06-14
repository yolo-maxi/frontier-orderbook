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

export type BookOutcome = "YES" | "NO";

export interface Fill {
  key: string;
  time: number; // ms
  outcome: BookOutcome; // which outcome book emitted this fill
  side: "buy" | "sell";
  priceLo: number;
  priceHi: number;
  size0: bigint; // token0 units
  value1: bigint; // token1 notional, computed with the book's closed form
  levels: number; // price levels crossed in this run
  block: bigint;
}

export interface MakerEvent {
  key: string;
  time: number; // ms
  outcome: BookOutcome; // which outcome book emitted this event
  kind: "place" | "requote" | "cancel" | "claim";
  side: "ask" | "bid" | null; // inferred from range vs current tick (null when unknown)
  positionId: bigint;
  maker: string | null; // owner address (Deposit events carry it)
  priceLo: number | null;
  priceHi: number | null;
  levels: number | null;
  size0: bigint | null; // per-level liquidity for place/requote
  total0: bigint | null; // size0 * levels (flat)
  payout: bigint | null; // proceeds for claim/cancel
  refund: bigint | null; // returned principal on cancel
  block: bigint;
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
  weth: bigint; // YES outcome token balance
  usdc: bigint; // sUSDC collateral balance
  no: bigint; // NO outcome token balance
}

/** What the chart should preview on top of live data. */
export interface ChartPreview {
  kind: "make" | "trade";
  side: "ask" | "bid"; // make: order side · trade: which side gets consumed
  lowerTick?: number;
  upperTick?: number;
  sizePerLevel?: bigint;
  slope?: bigint;
  endTick?: number; // trade: projected execution end
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
  /** NO book — live when the deployment ships a noBook, else null (NO derived). */
  noSummary: BookSummary | null;
  noDepth: DepthLevel[];
  /** noBook address when deployed, else null. */
  noBookAddr: `0x${string}` | null;
  fills: Fill[];
  makerEvents: MakerEvent[];
  priceHistory: PricePoint[];
  balances: Balances;
  positions: PositionRow[];
  rpcError: string | null;
  toasts: TxToast[];
  busy: string | null;
  preview: ChartPreview | null;
  setPreview: (p: ChartPreview | null) => void;
  /** Make tab is active: the book portion of the screen expands. */
  makeFocus: boolean;
  setMakeFocus: (b: boolean) => void;
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

/** Geometric notional (token1) of a run that swept the tick band [a, b].
 * GeometricFrontierBook price = 1.0001**tick, so we value the swept base size
 * at the run's mid price. Exact per-fill accounting lives on-chain; this is a
 * display approximation for the activity tape. */
function runNotional1(tickA: number, tickB: number, size0: bigint): bigint {
  const px = tickToPrice((tickA + tickB) / 2);
  const v = Number(size0) * px;
  return Number.isFinite(v) && v > 0 ? BigInt(Math.round(v)) : 0n;
}

const runFilledEvent = getAbiItem({ abi: bookAbi, name: "RunFilled" });
const intervalFilledEvent = getAbiItem({ abi: bookAbi, name: "IntervalFilled" });
const depositEvent = getAbiItem({ abi: bookAbi, name: "Deposit" });
const requoteEvent = getAbiItem({ abi: bookAbi, name: "Requote" });
const cancelEvent = getAbiItem({ abi: bookAbi, name: "Cancel" });
const claimEvent = getAbiItem({ abi: bookAbi, name: "Claim" });

const DEPTH_WINDOW = 8000; // ticks each side (shrinks adaptively if the node's eth_call gas cap is tight)
const MIN_DEPTH_WINDOW = 500;
/** Per-side cap on emitted levels. Ticks are $0.001 thin, so a real ladder
 * spans thousands of levels; the UI aggregates them into price buckets. */
const DEPTH_MAX_LEVELS = 4000n;
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

type RawLevel = { tick: number | bigint; askSize: bigint; bidSize: bigint };

/** Merge the lens's separate ask/bid scans into one per-tick depth ladder. */
function mergeDepth(askLevels: readonly RawLevel[], bidLevels: readonly RawLevel[]): DepthLevel[] {
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
  return [...merged.values()];
}

// ---------------------------------------------------------------- provider

export function AppProvider({ cfg, children }: { cfg: DeploymentConfig; children: ReactNode }) {
  const configured = useMemo(() => isConfigured(cfg), [cfg]);
  const noBookAddr = useMemo<`0x${string}` | null>(() => {
    const a = cfg.darkbox?.market?.noBook;
    return a && !/^0x0*$/.test(a) ? a : null;
  }, [cfg]);
  const noTokenAddr = useMemo<`0x${string}` | null>(() => {
    const a = cfg.darkbox?.market?.noToken;
    return a && !/^0x0*$/.test(a) ? a : null;
  }, [cfg]);
  const client = useMemo(() => makePublicClient(cfg), [cfg]);
  const account = useMemo(() => loadOrCreateAccount(), []);
  const wallet = useMemo(() => makeWalletClient(cfg, account), [cfg, account]);

  const [summary, setSummary] = useState<BookSummary | null>(null);
  const [depth, setDepth] = useState<DepthLevel[]>([]);
  const [noSummary, setNoSummary] = useState<BookSummary | null>(null);
  const [noDepth, setNoDepth] = useState<DepthLevel[]>([]);
  const [fills, setFills] = useState<Fill[]>([]);
  const [makerEvents, setMakerEvents] = useState<MakerEvent[]>([]);
  const [priceHistory, setPriceHistory] = useState<PricePoint[]>([]);
  const [balances, setBalances] = useState<Balances>({ eth: 0n, weth: 0n, usdc: 0n, no: 0n });
  const [positions, setPositions] = useState<PositionRow[]>([]);
  const [rpcError, setRpcError] = useState<string | null>(null);
  const [toasts, setToasts] = useState<TxToast[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [preview, setPreview] = useState<ChartPreview | null>(null);
  const [makeFocus, setMakeFocus] = useState(false);
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
        setDepth(mergeDepth(askLevels, bidLevels));
        setPriceHistory((h) => {
          const next = [...h, { t: Date.now(), price: tickToPrice(cur) }];
          return next.length > MAX_HISTORY ? next.slice(next.length - MAX_HISTORY) : next;
        });

        // NO book — live second leg when the deployment ships a noBook.
        if (noBookAddr) {
          try {
            const ns = await readSummary(client, cfg.contracts.lens, noBookAddr, win);
            const ncur = Number(ns.currentTick);
            const nBestAsk = Number(ns.bestAsk);
            const nBestBid = Number(ns.bestBid);
            const [nAsk, nBid] = await Promise.all([
              readDepth(client, cfg.contracts.lens, noBookAddr, ncur, ncur + win, DEPTH_MAX_LEVELS),
              readDepth(client, cfg.contracts.lens, noBookAddr, ncur - win, ncur, DEPTH_MAX_LEVELS),
            ]);
            if (!stop) {
              setNoSummary({
                currentTick: ncur,
                tickSpacing: Number(ns.tickSpacing),
                bestAsk: nBestAsk,
                bestBid: nBestBid,
                hasAsk: nBestAsk !== TICK_MAX && nBestAsk > ncur,
                hasBid: nBestBid !== TICK_MIN && nBestBid <= ncur,
              });
              setNoDepth(mergeDepth(nAsk, nBid));
            }
          } catch {
            /* NO book optional — YES leg already succeeded */
          }
        }
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
  }, [configured, client, cfg, noBookAddr, noteError, noteOk]);

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
          address: noBookAddr ? [cfg.contracts.book, noBookAddr] : cfg.contracts.book,
          events: [runFilledEvent, intervalFilledEvent, depositEvent, requoteEvent, cancelEvent, claimEvent],
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
        const makers: MakerEvent[] = [];
        const curTick = summaryRef.current?.currentTick ?? null;
        const sideOf = (lower: number, upper: number): "ask" | "bid" | null =>
          curTick === null ? null : lower > curTick ? "ask" : upper <= curTick + spacing ? "bid" : null;
        const noLc = noBookAddr?.toLowerCase();
        for (const log of logs) {
          const fillOutcome: BookOutcome = noLc && log.address.toLowerCase() === noLc ? "NO" : "YES";
          if (log.eventName === "Deposit" || log.eventName === "Requote") {
            const a = log.args as {
              positionId?: bigint;
              owner?: string;
              lower?: number;
              upper?: number;
              liquidity?: bigint;
            };
            if (a.positionId === undefined || a.lower === undefined || a.upper === undefined) continue;
            const lo = Number(a.lower);
            const hi = Number(a.upper);
            const lv = Math.max(1, Math.round((hi - lo) / spacing));
            makers.push({
              key: `${log.blockNumber}-${log.logIndex}`,
              time: now,
              outcome: fillOutcome,
              kind: log.eventName === "Deposit" ? "place" : "requote",
              side: sideOf(lo, hi),
              positionId: a.positionId,
              maker: a.owner ?? null,
              priceLo: tickToPrice(lo),
              priceHi: tickToPrice(hi),
              levels: lv,
              size0: a.liquidity ?? null,
              total0: a.liquidity !== undefined ? a.liquidity * BigInt(lv) : null,
              payout: null,
              refund: null,
              block: log.blockNumber ?? 0n,
            });
            continue;
          }
          if (log.eventName === "Cancel" || log.eventName === "Claim") {
            const a = log.args as { positionId?: bigint; proceeds1?: bigint; principal0?: bigint };
            if (a.positionId === undefined) continue;
            makers.push({
              key: `${log.blockNumber}-${log.logIndex}`,
              time: now,
              outcome: fillOutcome,
              kind: log.eventName === "Cancel" ? "cancel" : "claim",
              side: null,
              positionId: a.positionId,
              maker: null,
              priceLo: null,
              priceHi: null,
              levels: null,
              size0: null,
              total0: null,
              payout: a.proceeds1 ?? null,
              refund: a.principal0 ?? null,
              block: log.blockNumber ?? 0n,
            });
            continue;
          }
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
            // ask runs ascend (toBoundary > fromLevel); bid runs descend
            const isBuy = hi >= lo;
            const n = BigInt(Math.max(1, Math.round(Math.abs(hi - lo) / spacing)));
            const start = a.startSize ?? 0n;
            const slope = a.slopePerLevel ?? 0n;
            let size = start * n + (slope * n * (n - 1n)) / 2n;
            if (size < 0n) size = 0n;
            const value1 = runNotional1(lo, hi, size);
            parsed.push({
              key: `${log.blockNumber}-${log.logIndex}`,
              time: now,
              outcome: fillOutcome,
              side: isBuy ? "buy" : "sell",
              priceLo: tickToPrice(isBuy ? lo : hi + spacing),
              priceHi: tickToPrice(isBuy ? hi : lo + spacing),
              size0: size,
              value1,
              levels: Number(n),
              block: log.blockNumber ?? 0n,
            });
          } else {
            const a = log.args as { lowerTick?: number; liquidity?: bigint; proceeds1?: bigint };
            if (a.lowerTick === undefined) continue;
            const lo = Number(a.lowerTick);
            parsed.push({
              key: `${log.blockNumber}-${log.logIndex}`,
              time: now,
              outcome: fillOutcome,
              side: "sell", // bid interval filled: taker sold token0 into bids
              priceLo: tickToPrice(lo),
              priceHi: tickToPrice(lo + spacing),
              size0: a.liquidity ?? 0n,
              value1: a.proceeds1 ?? 0n,
              levels: 1,
              block: log.blockNumber ?? 0n,
            });
          }
        }
        if (parsed.length > 0) {
          setFills((f) => [...parsed.reverse(), ...f].slice(0, MAX_FILLS));
        }
        if (makers.length > 0) {
          setMakerEvents((m) => [...makers.reverse(), ...m].slice(0, MAX_FILLS));
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
  }, [configured, client, cfg, noBookAddr, noteError, noteOk]);

  // -------- balances (3s + manual)
  useEffect(() => {
    if (!configured) return;
    let stop = false;
    const tick = async () => {
      try {
        const [eth, weth, usdc, no] = await Promise.all([
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
          noTokenAddr
            ? client.readContract({
                address: noTokenAddr,
                abi: erc20Abi,
                functionName: "balanceOf",
                args: [account.address],
              })
            : Promise.resolve(0n),
        ]);
        if (!stop) setBalances({ eth, weth, usdc, no });
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
  }, [configured, client, cfg, account, noTokenAddr, nonce]);

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
  }, [configured, client, cfg, account, noTokenAddr, nonce]);

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

  // -------- faucet: top up gas, then mint collateral (and base on spot demos).
  // Decimals come from the manifest — no 18-decimal assumption. On the DarkBox
  // PM market only sUSDC is minted; users split it into YES + NO themselves.
  const faucet = useCallback(async () => {
    try {
      await ensureGas(client, cfg, account.address);
    } catch {
      /* may already have gas */
    }
    const isDarkbox = !!cfg.darkbox;
    const qDec = cfg.tokens?.quoteDecimals ?? 18;
    const quoteSym = cfg.tokens?.quote ?? "USDC";
    const okQuote = await sendTx(`Faucet: mint 1,000 ${quoteSym}`, () =>
      wallet.writeContract({
        address: cfg.contracts.usdc,
        abi: erc20Abi,
        functionName: "mint",
        args: [account.address, parseUnits("1000", qDec)],
      }),
    );
    if (!okQuote || isDarkbox) return;
    const bDec = cfg.tokens?.baseDecimals ?? 18;
    await sendTx(`Faucet: mint 10 ${cfg.tokens?.base ?? "WETH"}`, () =>
      wallet.writeContract({
        address: cfg.contracts.weth,
        abi: erc20Abi,
        functionName: "mint",
        args: [account.address, parseUnits("10", bDec)],
      }),
    );
  }, [client, cfg, account, wallet, sendTx]);

  const value: AppData = {
    cfg,
    configured,
    preview,
    setPreview,
    makeFocus,
    setMakeFocus,
    client,
    wallet,
    account,
    summary,
    depth,
    noSummary,
    noDepth,
    noBookAddr,
    fills,
    makerEvents,
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
