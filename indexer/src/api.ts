// I5 + I7 — REST API (Fastify) and WebSocket subscriptions.
//
// REST:  GET /markets, /book/:market, /positions/:owner, /trades (cursor-paged),
//        /stats/:market, /candles/:market, /account/:owner
// WS:    /fills, /depth  (server pushes ingest notifications to subscribers)

import Fastify, { type FastifyInstance } from "fastify";
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

export interface ApiDeps {
  db: DB;
  bus: Bus;
  logger?: boolean;
}

export function buildApi(deps: ApiDeps): FastifyInstance {
  const { db, bus } = deps;
  const app = Fastify({ logger: deps.logger ?? false });

  app.register(websocket);

  app.get("/health", async () => ({ ok: true, ts: Date.now() }));

  // ---- REST -----------------------------------------------------------------
  app.get("/markets", async () => ({ markets: listMarkets(db) }));

  app.get<{ Params: { market: string }; Querystring: { levels?: string } }>(
    "/book/:market",
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
    async (req, reply) => {
      const { market } = req.params;
      if (!isAddress(market)) return reply.code(400).send({ error: "invalid market address" });
      if (!getMarket(db, market)) return reply.code(404).send({ error: "unknown market" });
      const windowSecs = req.query.window ? Math.max(1, Number(req.query.window)) : undefined;
      return marketStats(db, market, windowSecs);
    },
  );

  app.get<{
    Params: { market: string };
    Querystring: { interval?: string; from?: string; to?: string; limit?: string };
  }>("/candles/:market", async (req, reply) => {
    const { market } = req.params;
    if (!isAddress(market)) return reply.code(400).send({ error: "invalid market address" });
    if (!getMarket(db, market)) return reply.code(404).send({ error: "unknown market" });
    const interval = req.query.interval ? Number(req.query.interval) : 3600;
    if (!Number.isFinite(interval) || interval <= 0)
      return reply.code(400).send({ error: "interval must be a positive number of seconds" });
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
  const wsHandler = (channel: "fills" | "depth") => (socket: any, req: any) => {
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
    socket.on("close", off);
    socket.on("error", off);
  };

  app.register(async (scoped) => {
    scoped.get("/fills", { websocket: true }, wsHandler("fills"));
    scoped.get("/depth", { websocket: true }, wsHandler("depth"));
  });

  return app;
}
