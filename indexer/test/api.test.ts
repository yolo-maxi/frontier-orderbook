import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { openDb, type DB } from "../src/db/index.js";
import { applyBatch } from "../src/ingest.js";
import { Bus } from "../src/bus.js";
import { buildApi } from "../src/api.js";
import { sampleEvents, BOOK, ALICE, TAKER } from "./fixtures/sampleEvents.js";
import type { FastifyInstance } from "fastify";

describe("REST API", () => {
  let db: DB;
  let app: FastifyInstance;

  beforeAll(async () => {
    db = openDb(":memory:");
    applyBatch(db, sampleEvents);
    app = buildApi({ db, bus: new Bus() });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    db.close();
  });

  it("GET /markets returns the indexed market", async () => {
    const res = await app.inject({ method: "GET", url: "/markets" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.markets).toHaveLength(1);
    expect(body.markets[0].address).toBe(BOOK);
  });

  it("GET /book/:market returns a depth snapshot", async () => {
    const res = await app.inject({ method: "GET", url: `/book/${BOOK}` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.asks.length).toBe(4);
    expect(body.bids.length).toBe(0);
  });

  it("GET /book/:market validates the address", async () => {
    const res = await app.inject({ method: "GET", url: "/book/not-an-address" });
    expect(res.statusCode).toBe(400);
  });

  it("GET /positions/:owner returns positions with claim-token info", async () => {
    const res = await app.inject({ method: "GET", url: `/positions/${ALICE}` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.positions).toHaveLength(1);
    expect(body.positions[0].positionId).toBe("1");
  });

  it("GET /trades?market= filters trades", async () => {
    const res = await app.inject({ method: "GET", url: `/trades?market=${BOOK}&side=buy` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.trades).toHaveLength(1);
    expect(body.trades[0].taker).toBe(TAKER);
  });

  it("GET /account/:owner returns rollups", async () => {
    const res = await app.inject({ method: "GET", url: `/account/${ALICE}` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.markets[0].proceedsClaimed).toBe("9895050");
  });

  it("GET /trades returns a nextCursor field", async () => {
    const res = await app.inject({ method: "GET", url: `/trades?market=${BOOK}&limit=1` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty("nextCursor");
    expect(Array.isArray(body.trades)).toBe(true);
  });

  it("GET /stats/:market returns volume, trade count, and open interest", async () => {
    const res = await app.inject({
      method: "GET",
      // huge window so the fixture's old timestamps are always included
      url: `/stats/${BOOK}?window=999999999999`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.market).toBe(BOOK);
    expect(body.tradeCount).toBe(1);
    expect(body.volume1).toBe("3300000");
    expect(body.livePositions).toBe(1);
    expect(BigInt(body.openInterest)).toBeGreaterThan(0n);
  });

  it("GET /stats/:market 404s for an unknown market", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/stats/0x00000000000000000000000000000000deadbeef",
    });
    expect(res.statusCode).toBe(404);
  });

  it("GET /candles/:market returns OHLC buckets from fills", async () => {
    const res = await app.inject({ method: "GET", url: `/candles/${BOOK}?interval=60` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.interval).toBe(60);
    expect(Array.isArray(body.candles)).toBe(true);
    // one interval fill in the fixture => one candle
    expect(body.candles).toHaveLength(1);
    expect(body.candles[0]).toHaveProperty("open");
    expect(body.candles[0]).toHaveProperty("volume");
  });

  it("GET /candles/:market rejects a non-positive interval", async () => {
    const res = await app.inject({ method: "GET", url: `/candles/${BOOK}?interval=0` });
    expect(res.statusCode).toBe(400);
  });
});
