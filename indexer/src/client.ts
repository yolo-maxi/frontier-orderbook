// Tiny typed client for the Frontier indexer REST + WebSocket API.
//
// Zero runtime dependencies: uses the platform `fetch` (Node >= 18 / browsers)
// and `WebSocket` (browsers, or `ws` injected via options). Import the types
// straight from the indexer's query layer so the client never drifts from the
// server's response shapes.
//
// Usage:
//   import { FrontierClient } from "@frontier/indexer/client";
//   const c = new FrontierClient("http://localhost:8787");
//   const { markets } = await c.markets();
//   const page = await c.trades({ market, limit: 50 });
//   const next = page.nextCursor ? await c.trades({ market, cursor: page.nextCursor }) : null;
//   const stop = c.subscribeFills((msg) => console.log(msg), { market });

import type { Market, PositionRow, Trade, MarketStats, Candle } from "./queries.js";

export type { Market, PositionRow, Trade, MarketStats, Candle };

export interface DepthLevel {
  tick: number;
  askSize: string;
  bidSize: string;
}
export interface Depth {
  market: string;
  currentTick: number | null;
  bids: DepthLevel[];
  asks: DepthLevel[];
}

export interface AccountSummary {
  owner: string;
  markets: Array<{
    market: string;
    livePositions: number;
    totalPositions: number;
    proceedsClaimed: string;
    principalReturned: string;
    feesPaidMaker: string;
    feesPaidTaker: string;
    updatedBlock: number | null;
  }>;
  claimTokens: Array<{
    wrapper: string;
    tokenId: string;
    market: string | null;
    positionId: string | null;
  }>;
}

export interface TradesPage {
  trades: Trade[];
  nextCursor: string | null;
}

export interface TradesQuery {
  market?: string;
  taker?: string;
  side?: "buy" | "sell";
  fromBlock?: number;
  toBlock?: number;
  limit?: number;
  cursor?: string;
}

export interface CandlesResponse {
  market: string;
  interval: number;
  candles: Candle[];
}

/** Minimal structural type for a WebSocket, so `ws` or the DOM type both fit. */
export interface WSLike {
  send(data: string): void;
  close(): void;
  addEventListener?(type: string, listener: (ev: any) => void): void;
  on?(type: string, listener: (ev: any) => void): void;
}

export interface FrontierClientOptions {
  /** Custom fetch (e.g. node-fetch / undici). Defaults to global `fetch`. */
  fetch?: typeof fetch;
  /**
   * WebSocket constructor. Defaults to the global `WebSocket` (browsers). In
   * Node, pass the `ws` package's class: `new FrontierClient(url, { WebSocket: WS })`.
   */
  WebSocket?: new (url: string) => WSLike;
}

export type WsChannel = "fills" | "depth";
export interface WsEnvelope<T = unknown> {
  type: WsChannel | "subscribed";
  channel?: WsChannel;
  market?: string | null;
  data?: T;
}

function qs(params: Record<string, unknown>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

export class FrontierClient {
  private base: string;
  private wsBase: string;
  private fetchImpl: typeof fetch;
  private WS?: new (url: string) => WSLike;

  constructor(baseUrl: string, opts: FrontierClientOptions = {}) {
    this.base = baseUrl.replace(/\/+$/, "");
    this.wsBase = this.base.replace(/^http/, "ws");
    const f = opts.fetch ?? (globalThis as any).fetch;
    if (!f) throw new Error("FrontierClient: no fetch available; pass opts.fetch");
    this.fetchImpl = f;
    this.WS = opts.WebSocket ?? (globalThis as any).WebSocket;
  }

  private async get<T>(path: string): Promise<T> {
    const res = await this.fetchImpl(`${this.base}${path}`);
    if (!res.ok) {
      let detail = "";
      try {
        detail = ((await res.json()) as { error?: string })?.error ?? "";
      } catch {
        /* non-JSON body */
      }
      throw new Error(`GET ${path} -> ${res.status}${detail ? `: ${detail}` : ""}`);
    }
    return (await res.json()) as T;
  }

  // ---- REST ----------------------------------------------------------------
  health(): Promise<{ ok: boolean; ts: number }> {
    return this.get("/health");
  }

  markets(): Promise<{ markets: Market[] }> {
    return this.get("/markets");
  }

  book(market: string, levels?: number): Promise<Depth> {
    return this.get(`/book/${market}${qs({ levels })}`);
  }

  positions(owner: string, liveOnly = false): Promise<{ owner: string; positions: PositionRow[] }> {
    return this.get(`/positions/${owner}${qs({ live: liveOnly ? "true" : undefined })}`);
  }

  trades(q: TradesQuery = {}): Promise<TradesPage> {
    return this.get(`/trades${qs(q as Record<string, unknown>)}`);
  }

  /**
   * Async iterator over all trade pages, following `nextCursor`. Rate-limit
   * friendly: one request per page, no concurrency. Optional `pageDelayMs`
   * sleeps between pages to stay under a server's request budget.
   */
  async *tradesAll(
    q: Omit<TradesQuery, "cursor"> = {},
    pageDelayMs = 0,
  ): AsyncGenerator<Trade, void, unknown> {
    let cursor: string | null | undefined = undefined;
    do {
      const page: TradesPage = await this.trades({ ...q, cursor: cursor ?? undefined });
      for (const t of page.trades) yield t;
      cursor = page.nextCursor;
      if (cursor && pageDelayMs > 0) await new Promise((r) => setTimeout(r, pageDelayMs));
    } while (cursor);
  }

  stats(market: string, windowSecs?: number): Promise<MarketStats> {
    return this.get(`/stats/${market}${qs({ window: windowSecs })}`);
  }

  candles(
    market: string,
    interval: number,
    range: { from?: number; to?: number; limit?: number } = {},
  ): Promise<CandlesResponse> {
    return this.get(`/candles/${market}${qs({ interval, ...range })}`);
  }

  account(owner: string): Promise<AccountSummary> {
    return this.get(`/account/${owner}`);
  }

  // ---- WebSocket -----------------------------------------------------------
  private subscribe<T>(
    channel: WsChannel,
    onMessage: (msg: WsEnvelope<T>) => void,
    opts: { market?: string; onError?: (e: unknown) => void } = {},
  ): () => void {
    if (!this.WS) throw new Error("FrontierClient: no WebSocket available; pass opts.WebSocket");
    const url = `${this.wsBase}/${channel}${qs({ market: opts.market })}`;
    const sock = new this.WS(url);
    const handleMessage = (ev: any) => {
      try {
        const raw = typeof ev?.data === "string" ? ev.data : ev?.data?.toString?.() ?? ev;
        onMessage(JSON.parse(raw) as WsEnvelope<T>);
      } catch (e) {
        opts.onError?.(e);
      }
    };
    const handleError = (e: any) => opts.onError?.(e);
    // Support both the DOM (addEventListener) and `ws` (on) event styles.
    if (sock.addEventListener) {
      sock.addEventListener("message", handleMessage);
      sock.addEventListener("error", handleError);
    } else if (sock.on) {
      sock.on("message", (data: any) => handleMessage({ data }));
      sock.on("error", handleError);
    }
    return () => {
      try {
        sock.close();
      } catch {
        /* already closed */
      }
    };
  }

  /** Subscribe to the fills/trades stream. Returns an unsubscribe function. */
  subscribeFills(
    onMessage: (msg: WsEnvelope) => void,
    opts: { market?: string; onError?: (e: unknown) => void } = {},
  ): () => void {
    return this.subscribe("fills", onMessage, opts);
  }

  /** Subscribe to the depth/book-mutation stream. Returns an unsubscribe fn. */
  subscribeDepth(
    onMessage: (msg: WsEnvelope) => void,
    opts: { market?: string; onError?: (e: unknown) => void } = {},
  ): () => void {
    return this.subscribe("depth", onMessage, opts);
  }
}
