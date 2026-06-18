import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { openDb, type DB } from "../src/db/index.js";
import { Bus } from "../src/bus.js";
import { buildApi } from "../src/api.js";
import {
  depthSnapshot,
  DEPTH_MAX_POSITIONS,
  DEPTH_MAX_LEVELS_PER_POSITION,
} from "../src/queries.js";
import { validateRpcUrl, loadConfig } from "../src/config.js";
import {
  WINDOW_MAX_SECS,
  INTERVAL_MAX_SECS,
  INTERVAL_MIN_SECS,
} from "../src/api.js";
import type { FastifyInstance } from "fastify";

const MARKET = "0x00000000000000000000000000000000000000c0";

function seedMarket(db: DB, spacing = 1) {
  db.prepare(
    `INSERT INTO markets (address, token0, token1, tick_spacing, current_tick,
       maker_fee_bps, taker_fee_bps) VALUES (?, ?, ?, ?, ?, 0, 0)`,
  ).run(MARKET, "0x" + "1".padStart(40, "0"), "0x" + "2".padStart(40, "0"), spacing, 0);
}

function insertPosition(
  db: DB,
  id: number,
  lower: number,
  upper: number,
  liquidity: string,
  isBid = 0,
  block = id,
) {
  db.prepare(
    `INSERT INTO positions (market, position_id, owner, lower_tick, upper_tick,
       liquidity, is_bid, live, deposit_block) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`,
  ).run(MARKET, String(id), "0x" + "a".padStart(40, "0"), lower, upper, liquidity, isBid, block);
}

describe("depthSnapshot position cap", () => {
  it("caps the number of live positions scanned", () => {
    const db = openDb(":memory:");
    seedMarket(db, 1);
    // Insert more than the cap, each a single-tick position so each row maps to
    // one distinct tick. The cap means only the newest DEPTH_MAX_POSITIONS rows
    // contribute (ordered by deposit_block DESC).
    const n = DEPTH_MAX_POSITIONS + 50;
    const insert = db.transaction(() => {
      for (let i = 1; i <= n; i++) insertPosition(db, i, i, i + 1, "1", 0, i);
    });
    insert();

    const snap = depthSnapshot(db, MARKET, 100_000);
    // Distinct ask ticks must never exceed the scanned-position cap.
    expect(snap.asks.length).toBeLessThanOrEqual(DEPTH_MAX_POSITIONS);
    db.close();
  });

  it("bounds a single pathological wide-range position", () => {
    const db = openDb(":memory:");
    seedMarket(db, 1);
    // One position spanning far more than the per-position level cap.
    insertPosition(db, 1, 0, DEPTH_MAX_LEVELS_PER_POSITION + 5_000, "1", 0, 1);
    const snap = depthSnapshot(db, MARKET, Number.MAX_SAFE_INTEGER);
    // Even before maxLevels truncation, the inner loop must stop at the cap.
    expect(snap.asks.length).toBeLessThanOrEqual(DEPTH_MAX_LEVELS_PER_POSITION);
    db.close();
  });
});

describe("validateRpcUrl", () => {
  it("accepts http and https URLs", () => {
    expect(validateRpcUrl("http://127.0.0.1:8545")).toBe("http://127.0.0.1:8545");
    expect(validateRpcUrl("https://rpc.example.com/v2/key")).toBe(
      "https://rpc.example.com/v2/key",
    );
  });

  it("rejects non-http(s) protocols", () => {
    expect(() => validateRpcUrl("ws://127.0.0.1:8545")).toThrow(/http/);
    expect(() => validateRpcUrl("file:///etc/passwd")).toThrow(/http/);
  });

  it("rejects unparseable URLs", () => {
    expect(() => validateRpcUrl("not a url")).toThrow(/valid URL/);
  });

  it("never echoes embedded credentials in the error message", () => {
    const secret = "https://user:SUPERSECRET@host"; // valid URL, https -> ok
    expect(validateRpcUrl(secret)).toBe(secret);
    // A bad-protocol URL with creds must not leak the secret in the thrown error.
    let msg = "";
    try {
      validateRpcUrl("ftp://user:SUPERSECRET@host");
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).not.toContain("SUPERSECRET");
  });

  it("loadConfig rejects a bad RPC_URL", () => {
    expect(() => loadConfig({ RPC_URL: "ws://localhost" } as NodeJS.ProcessEnv)).toThrow(
      /http/,
    );
  });
});

describe("API query param clamping", () => {
  let db: DB;
  let app: FastifyInstance;

  beforeAll(async () => {
    db = openDb(":memory:");
    seedMarket(db, 1);
    insertPosition(db, 1, 0, 4, "1000", 0, 1);
    app = await buildApi({ db, bus: new Bus(), rateLimit: { enabled: false } });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    db.close();
  });

  it("clamps an oversized ?window to WINDOW_MAX_SECS", async () => {
    const res = await app.inject({ method: "GET", url: `/stats/${MARKET}?window=999999999999` });
    expect(res.statusCode).toBe(200);
    expect(res.json().windowSecs).toBe(WINDOW_MAX_SECS);
  });

  it("clamps a tiny ?window up to the minimum", async () => {
    const res = await app.inject({ method: "GET", url: `/stats/${MARKET}?window=1` });
    expect(res.statusCode).toBe(200);
    expect(res.json().windowSecs).toBe(60);
  });

  it("clamps an oversized ?interval to INTERVAL_MAX_SECS", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/candles/${MARKET}?interval=999999999`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().interval).toBe(INTERVAL_MAX_SECS);
  });

  it("clamps a tiny ?interval up to the minimum", async () => {
    const res = await app.inject({ method: "GET", url: `/candles/${MARKET}?interval=5` });
    expect(res.statusCode).toBe(200);
    expect(res.json().interval).toBe(INTERVAL_MIN_SECS);
  });

  it("still rejects a non-positive interval", async () => {
    const res = await app.inject({ method: "GET", url: `/candles/${MARKET}?interval=0` });
    expect(res.statusCode).toBe(400);
  });
});

describe("rate limiting", () => {
  it("returns 429 after exceeding the global budget", async () => {
    const db = openDb(":memory:");
    seedMarket(db, 1);
    const app = await buildApi({
      db,
      bus: new Bus(),
      rateLimit: { enabled: true, globalMax: 3, windowMs: 60_000 },
    });
    await app.ready();

    const codes: number[] = [];
    for (let i = 0; i < 6; i++) {
      const res = await app.inject({ method: "GET", url: "/markets" });
      codes.push(res.statusCode);
    }
    expect(codes.filter((c) => c === 200).length).toBe(3);
    expect(codes.some((c) => c === 429)).toBe(true);

    await app.close();
    db.close();
  });

  it("applies a stricter budget to expensive endpoints", async () => {
    const db = openDb(":memory:");
    seedMarket(db, 1);
    const app = await buildApi({
      db,
      bus: new Bus(),
      rateLimit: { enabled: true, globalMax: 1000, expensiveMax: 2, windowMs: 60_000 },
    });
    await app.ready();

    const codes: number[] = [];
    for (let i = 0; i < 5; i++) {
      const res = await app.inject({ method: "GET", url: `/book/${MARKET}` });
      codes.push(res.statusCode);
    }
    expect(codes.filter((c) => c === 200).length).toBe(2);
    expect(codes.some((c) => c === 429)).toBe(true);

    await app.close();
    db.close();
  });
});
