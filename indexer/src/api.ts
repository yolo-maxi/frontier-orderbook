// I5 + I7 — REST API (Fastify) and WebSocket subscriptions.
//
// REST:  GET /markets, /book/:market, /positions/:owner, /trades (cursor-paged),
//        /stats/:market, /candles/:market, /account/:owner
// WS:    /fills, /depth  (server pushes ingest notifications to subscribers)

import Fastify, { type FastifyInstance } from "fastify";
import rateLimit from "@fastify/rate-limit";
import websocket from "@fastify/websocket";
import type { DB } from "./db/index.js";
import type { Bus } from "./bus.js";
import {
  listMarkets,
  getMarket,
  depthSnapshot,
  positionsByOwner,
  listTradesPage,
  accountSummary,
  marketStats,
  candles,
} from "./queries.js";

const isAddress = (s: string) => /^0x[0-9a-fA-F]{40}$/.test(s);

// Bounds for time-range query params, to stop callers requesting pathological
// ranges (e.g. window=1 forcing huge scans, or interval=huge producing a single
// bucket over all history).
const MINUTE = 60;
const DAY = 86_400;
export const WINDOW_MIN_SECS = MINUTE; // 60s
export const WINDOW_MAX_SECS = 365 * DAY; // 1 year
export const INTERVAL_MIN_SECS = MINUTE; // 60s
export const INTERVAL_MAX_SECS = 7 * DAY; // 1 week

/** Clamp a numeric query param into [min, max]; returns undefined if absent/NaN. */
function clampParam(raw: string | undefined, min: number, max: number): number | undefined {
  if (raw === undefined) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n)) return undefined;
  return Math.min(Math.max(Math.floor(n), min), max);
}

export interface RateLimitOptions {
  /** Enable the rate limiter. Default true. Tests can disable it. */
  enabled?: boolean;
  /** Global per-IP request budget per window. Default 600. */
  globalMax?: number;
  /** Stricter per-IP budget for expensive scan/aggregation endpoints. Default 120. */
  expensiveMax?: number;
  /** Window for both budgets, in milliseconds. Default 60_000 (1 min). */
  windowMs?: number;
  /** Max concurrent WebSocket connections per IP. Default 10. */
  wsMaxPerIp?: number;
}

export interface ApiDeps {
  db: DB;
  bus: Bus;
  logger?: boolean;
  rateLimit?: RateLimitOptions;
}

export async function buildApi(deps: ApiDeps): Promise<FastifyInstance> {
  const { db, bus } = deps;
  const app = Fastify({ logger: deps.logger ?? false });

  const rl: Required<RateLimitOptions> = {
    enabled: deps.rateLimit?.enabled ?? true,
    globalMax: deps.rateLimit?.globalMax ?? 600,
    expensiveMax: deps.rateLimit?.expensiveMax ?? 120,
    windowMs: deps.rateLimit?.windowMs ?? 60_000,
    wsMaxPerIp: deps.rateLimit?.wsMaxPerIp ?? 10,
  };

  if (rl.enabled) {
    // Global limiter: a generous per-IP budget guards every route. Expensive
    // endpoints additionally opt into a stricter limit via their route config.
    await app.register(rateLimit, {
      global: true,
      max: rl.globalMax,
      timeWindow: rl.windowMs,
    });
  }

  // Per-route stricter limit for scan/aggregation-heavy endpoints. Falls back to
  // an empty config when the limiter is disabled (tests).
  const expensiveLimit = rl.enabled
    ? { config: { rateLimit: { max: rl.expensiveMax, timeWindow: rl.windowMs } } }
    : {};

  await app.register(websocket);

  app.get("/health", async () => ({ ok: true, ts: Date.now() }));

  // ---- REST -----------------------------------------------------------------
  app.get("/markets", async () => ({ markets: listMarkets(db) }));

  app.get<{ Params: { market: string }; Querystring: { levels?: string } }>(
    "/book/:market",
    expensiveLimit,
    async (req, reply) => {
      const { market } = req.params;
      if (!isAddress(market)) return reply.code(400).send({ error: "invalid market address" });
      if (!getMarket(db, market)) return reply.code(404).send({ error: "unknown market" });
      const levels = req.query.levels ? Math.min(Number(req.query.levels), 1000) : 200;
      return depthSnapshot(db, market, levels);
    },
  );

  app.get<{ Params: { owner: string }; Querystring: { live?: string } }>(
    "/positions/:owner",
    async (req, reply) => {
      const { owner } = req.params;
      if (!isAddress(owner)) return reply.code(400).send({ error: "invalid owner address" });
      const includeClosed = req.query.live !== "true";
      return { owner: owner.toLowerCase(), positions: positionsByOwner(db, owner, includeClosed) };
    },
  );

  app.get<{
    Querystring: {
      market?: string;
      taker?: string;
      side?: string;
      fromBlock?: string;
      toBlock?: string;
      limit?: string;
      cursor?: string;
    };
  }>("/trades", async (req, reply) => {
    const q = req.query;
    if (q.market && !isAddress(q.market)) return reply.code(400).send({ error: "invalid market" });
    if (q.taker && !isAddress(q.taker)) return reply.code(400).send({ error: "invalid taker" });
    if (q.side && q.side !== "buy" && q.side !== "sell")
      return reply.code(400).send({ error: "side must be buy|sell" });
    const page = listTradesPage(db, {
      market: q.market,
      taker: q.taker,
      side: q.side as "buy" | "sell" | undefined,
      fromBlock: q.fromBlock !== undefined ? Number(q.fromBlock) : undefined,
      toBlock: q.toBlock !== undefined ? Number(q.toBlock) : undefined,
      limit: q.limit !== undefined ? Number(q.limit) : undefined,
      cursor: q.cursor,
    });
    // `trades` kept for back-compat; `nextCursor` drives pagination.
    return { trades: page.items, nextCursor: page.nextCursor };
  });

  // ---- Stats / charts -------------------------------------------------------
  app.get<{ Params: { market: string }; Querystring: { window?: string } }>(
    "/stats/:market",
    expensiveLimit,
    async (req, reply) => {
      const { market } = req.params;
      if (!isAddress(market)) return reply.code(400).send({ error: "invalid market address" });
      if (!getMarket(db, market)) return reply.code(404).send({ error: "unknown market" });
      const windowSecs = clampParam(req.query.window, WINDOW_MIN_SECS, WINDOW_MAX_SECS);
      return marketStats(db, market, windowSecs);
    },
  );

  app.get<{
    Params: { market: string };
    Querystring: { interval?: string; from?: string; to?: string; limit?: string };
  }>("/candles/:market", expensiveLimit, async (req, reply) => {
    const { market } = req.params;
    if (!isAddress(market)) return reply.code(400).send({ error: "invalid market address" });
    if (!getMarket(db, market)) return reply.code(404).send({ error: "unknown market" });
    const rawInterval = req.query.interval !== undefined ? Number(req.query.interval) : 3600;
    if (!Number.isFinite(rawInterval) || rawInterval <= 0)
      return reply.code(400).send({ error: "interval must be a positive number of seconds" });
    // Clamp to sane bounds (60s..7d) so a caller can't request a pathological
    // bucket size that collapses all history into one (or millions of) buckets.
    const interval = Math.min(Math.max(Math.floor(rawInterval), INTERVAL_MIN_SECS), INTERVAL_MAX_SECS);
    return {
      market: market.toLowerCase(),
      interval,
      candles: candles(db, {
        market,
        interval,
        from: req.query.from !== undefined ? Number(req.query.from) : undefined,
        to: req.query.to !== undefined ? Number(req.query.to) : undefined,
        limit: req.query.limit !== undefined ? Number(req.query.limit) : undefined,
      }),
    };
  });

  app.get<{ Params: { owner: string } }>("/account/:owner", async (req, reply) => {
    const { owner } = req.params;
    if (!isAddress(owner)) return reply.code(400).send({ error: "invalid owner address" });
    return accountSummary(db, owner);
  });

  // ---- WebSocket ------------------------------------------------------------
  // Clean interface: connect to /fills or /depth and receive newline-free JSON
  // frames. Optionally filter by market via ?market=0x...
  //
  // Per-IP connection cap: a single client can't exhaust server sockets by
  // opening unbounded WebSocket subscriptions.
  const wsConnsByIp = new Map<string, number>();
  const wsHandler = (channel: "fills" | "depth") => (socket: any, req: any) => {
    const ip =
      (typeof req.ip === "string" && req.ip) ||
      req.socket?.remoteAddress ||
      "unknown";
    const current = wsConnsByIp.get(ip) ?? 0;
    if (rl.enabled && current >= rl.wsMaxPerIp) {
      try {
        socket.send(JSON.stringify({ type: "error", error: "too many websocket connections" }));
      } catch {
        /* ignore */
      }
      socket.close(1013, "rate limited");
      return;
    }
    wsConnsByIp.set(ip, current + 1);
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      const n = (wsConnsByIp.get(ip) ?? 1) - 1;
      if (n <= 0) wsConnsByIp.delete(ip);
      else wsConnsByIp.set(ip, n);
    };

    const url = new URL(req.url ?? "/", "http://localhost");
    const marketFilter = url.searchParams.get("market")?.toLowerCase() ?? null;

    socket.send(JSON.stringify({ type: "subscribed", channel, market: marketFilter }));
    const off = bus.on(channel, (payload: any) => {
      if (marketFilter && payload?.market && payload.market !== marketFilter) return;
      try {
        socket.send(JSON.stringify({ type: channel, data: payload }));
      } catch {
        /* socket closing */
      }
    });
    const cleanup = () => {
      off();
      release();
    };
    socket.on("close", cleanup);
    socket.on("error", cleanup);
  };

  app.register(async (scoped) => {
    scoped.get("/fills", { websocket: true }, wsHandler("fills"));
    scoped.get("/depth", { websocket: true }, wsHandler("depth"));
  });

  return app;
}
