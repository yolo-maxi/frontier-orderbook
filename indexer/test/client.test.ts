import { describe, it, expect, beforeAll, afterAll } from "vitest";
import WS from "ws";
import { openDb, type DB } from "../src/db/index.js";
import { applyBatch } from "../src/ingest.js";
import { Bus } from "../src/bus.js";
import { buildApi } from "../src/api.js";
import { FrontierClient } from "../src/client.js";
import { sampleEvents, BOOK, ALICE } from "./fixtures/sampleEvents.js";
import type { FastifyInstance } from "fastify";

describe("FrontierClient (against a live server)", () => {
  let db: DB;
  let app: FastifyInstance;
  let bus: Bus;
  let client: FrontierClient;
  let baseUrl: string;

  beforeAll(async () => {
    db = openDb(":memory:");
    applyBatch(db, sampleEvents);
    bus = new Bus();
    app = buildApi({ db, bus });
    await app.listen({ port: 0, host: "127.0.0.1" });
    const addr = app.server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    baseUrl = `http://127.0.0.1:${port}`;
    client = new FrontierClient(baseUrl, { WebSocket: WS as any });
  });

  afterAll(async () => {
    await app.close();
    db.close();
  });

  it("fetches markets via the typed wrapper", async () => {
    const { markets } = await client.markets();
    expect(markets).toHaveLength(1);
    expect(markets[0]!.address).toBe(BOOK);
  });

  it("fetches a depth snapshot", async () => {
    const depth = await client.book(BOOK);
    expect(depth.market).toBe(BOOK);
    expect(depth.asks.length).toBe(4);
  });

  it("fetches positions and account summary", async () => {
    const { positions } = await client.positions(ALICE);
    expect(positions).toHaveLength(1);
    const acct = await client.account(ALICE);
    expect(acct.markets[0]!.proceedsClaimed).toBe("9895050");
  });

  it("paginates trades and exposes nextCursor", async () => {
    const page = await client.trades({ market: BOOK, limit: 1 });
    expect(Array.isArray(page.trades)).toBe(true);
    expect(page).toHaveProperty("nextCursor");
  });

  it("tradesAll iterates every trade across pages", async () => {
    const all = [];
    for await (const t of client.tradesAll({ market: BOOK, limit: 1 })) all.push(t);
    expect(all).toHaveLength(1); // fixture has exactly one trade
  });

  it("fetches stats and candles", async () => {
    const stats = await client.stats(BOOK, 999_999_999_999);
    expect(stats.tradeCount).toBe(1);
    const { candles } = await client.candles(BOOK, 60);
    expect(candles).toHaveLength(1);
  });

  it("throws a descriptive error on a 404", async () => {
    await expect(
      client.stats("0x00000000000000000000000000000000deadbeef"),
    ).rejects.toThrow(/404/);
  });

  it("subscribeFills receives broadcast fill events", async () => {
    const got = await new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("timeout waiting for fill")), 3000);
      const stop = client.subscribeFills(
        (msg) => {
          if (msg.type === "fills") {
            clearTimeout(timer);
            stop();
            resolve(msg.data);
          }
        },
        { market: BOOK },
      );
      // give the socket a moment to register before broadcasting
      setTimeout(() => bus.emit("fills", { market: BOOK, kind: "trade" }), 300);
    });
    expect(got).toMatchObject({ market: BOOK, kind: "trade" });
  });
});
