import { describe, it, expect, beforeEach } from "vitest";
import { openDb, type DB } from "../src/db/index.js";
import { applyBatch } from "../src/ingest.js";
import { marketStats, candles, tickToPrice, listTradesPage } from "../src/queries.js";
import type { DecodedEvent } from "../src/types.js";
import { sampleEvents, BOOK, TOKEN1 } from "./fixtures/sampleEvents.js";

// The sample fixture's events are timestamped around 1_700_000_000. Use a fixed
// `now` just after that so the 24h window deterministically includes them.
const NOW = 1_700_000_100;

describe("market stats", () => {
  let db: DB;
  beforeEach(() => {
    db = openDb(":memory:");
    applyBatch(db, sampleEvents);
  });

  it("reports 24h trade count, per-token volume, and taker fees", () => {
    const s = marketStats(db, BOOK, 86_400, NOW);
    expect(s.market).toBe(BOOK);
    expect(s.tradeCount).toBe(1);
    // taker paid TOKEN1 (USDC) gross 9_900_000, fee 2_970
    expect(s.volumeByToken[TOKEN1]).toBe("9900000");
    expect(s.feesByToken[TOKEN1]).toBe("2970");
    // token1 fill volume = sum of interval-fill proceeds1 = 3_300_000
    expect(s.volume1).toBe("3300000");
  });

  it("excludes activity outside the window", () => {
    // window of 1s ending at NOW excludes everything (events are ~100s old)
    const s = marketStats(db, BOOK, 1, NOW);
    expect(s.tradeCount).toBe(0);
    expect(s.volume1).toBe("0");
    expect(Object.keys(s.volumeByToken)).toHaveLength(0);
  });

  it("computes open interest from live positions", () => {
    // Alice's live ask [100,140) spacing 10 => 4 levels * 1e18 each.
    const s = marketStats(db, BOOK, 86_400, NOW);
    expect(s.livePositions).toBe(1);
    expect(s.openInterest).toBe((4n * 1_000_000_000_000_000_000n).toString());
  });
});

describe("candles / OHLC", () => {
  let db: DB;
  beforeEach(() => {
    db = openDb(":memory:");
  });

  it("tickToPrice is monotonic and 1.0 at tick 0", () => {
    expect(tickToPrice(0)).toBeCloseTo(1, 12);
    expect(tickToPrice(100)).toBeGreaterThan(tickToPrice(0));
    expect(tickToPrice(-100)).toBeLessThan(tickToPrice(0));
  });

  it("aggregates interval fills into OHLC buckets", () => {
    const fill = (tick: number, proceeds1: bigint, ts: number, logIndex: number): DecodedEvent => ({
      source: "book",
      eventName: "IntervalFilled",
      address: BOOK as `0x${string}`,
      args: { lowerTick: BigInt(tick), liquidity: 1n, proceeds1, clock: 1n },
      blockNumber: BigInt(1000 + logIndex),
      logIndex,
      transactionHash: ("0x" + "f".repeat(64)) as `0x${string}`,
      timestamp: ts,
    });
    // Two fills in bucket A (60s), one in bucket B.
    const t0 = 1_700_000_000;
    applyBatch(db, [
      fill(100, 1000n, t0 + 5, 0), // bucket [t0, t0+60)
      fill(120, 2000n, t0 + 30, 1), // same bucket, higher tick
      fill(80, 500n, t0 + 65, 2), // next bucket
    ]);

    const cs = candles(db, { market: BOOK, interval: 60 });
    expect(cs).toHaveLength(2);

    const a = cs[0]!;
    expect(a.time).toBe(Math.floor((t0 + 5) / 60) * 60);
    expect(a.open).toBeCloseTo(tickToPrice(100), 9);
    expect(a.high).toBeCloseTo(tickToPrice(120), 9);
    expect(a.low).toBeCloseTo(tickToPrice(100), 9);
    expect(a.close).toBeCloseTo(tickToPrice(120), 9);
    expect(a.volume).toBe("3000");
    expect(a.trades).toBe(2);

    const b = cs[1]!;
    expect(b.open).toBeCloseTo(tickToPrice(80), 9);
    expect(b.volume).toBe("500");
    expect(b.trades).toBe(1);
  });
});

describe("trade pagination (keyset cursor)", () => {
  let db: DB;
  beforeEach(() => {
    db = openDb(":memory:");
    // synthesize 5 trades on one market across distinct blocks
    const trades: DecodedEvent[] = [];
    for (let i = 0; i < 5; i++) {
      trades.push({
        source: "book",
        eventName: "TakerFee",
        address: BOOK as `0x${string}`,
        args: {
          payer: "0x0000000000000000000000000000000000007a4e",
          token: TOKEN1,
          grossInput: BigInt(100 + i),
          fee: 1n,
          totalPaid: BigInt(101 + i),
          recipient: "0x000000000000000000000000000000000000ca01",
        },
        blockNumber: BigInt(200 + i),
        logIndex: 0,
        transactionHash: ("0x" + i.toString(16).padStart(64, "0")) as `0x${string}`,
        timestamp: 1_700_000_000 + i,
      });
    }
    applyBatch(db, trades);
  });

  it("walks all trades via nextCursor with no gaps or dupes", () => {
    const seen: number[] = [];
    let cursor: string | undefined;
    for (let guard = 0; guard < 10; guard++) {
      const page = listTradesPage(db, { market: BOOK, limit: 2, cursor });
      for (const t of page.items) seen.push(t.blockNumber);
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
    }
    // newest-first, all 5 blocks, unique
    expect(seen).toEqual([204, 203, 202, 201, 200]);
    expect(new Set(seen).size).toBe(5);
  });

  it("nextCursor is null on the final page", () => {
    const page = listTradesPage(db, { market: BOOK, limit: 100 });
    expect(page.items).toHaveLength(5);
    expect(page.nextCursor).toBeNull();
  });

  it("ignores a malformed cursor (returns first page)", () => {
    const page = listTradesPage(db, { market: BOOK, limit: 2, cursor: "!!!not-base64!!!" });
    expect(page.items).toHaveLength(2);
    expect(page.items[0]!.blockNumber).toBe(204);
  });
});
