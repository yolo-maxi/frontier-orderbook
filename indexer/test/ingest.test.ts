import { describe, it, expect, beforeEach } from "vitest";
import { openDb, type DB } from "../src/db/index.js";
import { applyBatch } from "../src/ingest.js";
import {
  listMarkets,
  depthSnapshot,
  positionsByOwner,
  listTrades,
  accountSummary,
} from "../src/queries.js";
import { sampleEvents, BOOK, ALICE, BOB, CAROL, TAKER, NFT } from "./fixtures/sampleEvents.js";

describe("ingest + queries (replayed sample events)", () => {
  let db: DB;
  beforeEach(() => {
    db = openDb(":memory:");
    applyBatch(db, sampleEvents);
  });

  it("creates the market from BookCreated", () => {
    const markets = listMarkets(db);
    expect(markets).toHaveLength(1);
    expect(markets[0]!.address).toBe(BOOK);
    expect(markets[0]!.tickSpacing).toBe(10);
    expect(markets[0]!.makerFeeBps).toBe(5);
    expect(markets[0]!.takerFeeBps).toBe(3);
  });

  it("records positions with correct geometry and live state", () => {
    const aliceP = positionsByOwner(db, ALICE);
    expect(aliceP).toHaveLength(1);
    expect(aliceP[0]!.positionId).toBe("1");
    expect(aliceP[0]!.live).toBe(true);
    expect(aliceP[0]!.lowerTick).toBe(100);
    expect(aliceP[0]!.upperTick).toBe(140);

    const bobP = positionsByOwner(db, BOB);
    expect(bobP).toHaveLength(1);
    expect(bobP[0]!.isBid).toBe(false); // deposited via Deposit (ask path)
    // Bob cancelled -> not live
    expect(bobP[0]!.live).toBe(false);
  });

  it("tracks claimed proceeds on the position and account", () => {
    const aliceP = positionsByOwner(db, ALICE);
    expect(aliceP[0]!.claimed).toBe("9895050");

    const acct = accountSummary(db, ALICE);
    const mk = acct.markets.find((m) => m.market === BOOK)!;
    expect(mk.proceedsClaimed).toBe("9895050");
    expect(mk.feesPaidMaker).toBe("4950");
    expect(mk.livePositions).toBe(1);
  });

  it("records fills and a depth snapshot from live positions", () => {
    const depth = depthSnapshot(db, BOOK);
    // Alice ask ladder [100,140) at spacing 10 => 4 ask levels (100,110,120,130)
    expect(depth.asks).toHaveLength(4);
    expect(depth.asks.map((a) => a.tick)).toEqual([100, 110, 120, 130]);
    expect(depth.asks[0]!.askSize).toBe("1000000000000000000");
    // Bob's bid was cancelled, so no bid depth remains
    expect(depth.bids).toHaveLength(0);
  });

  it("records the taker trade with inferred side and fee accounting", () => {
    const trades = listTrades(db, { market: BOOK });
    expect(trades).toHaveLength(1);
    expect(trades[0]!.taker).toBe(TAKER);
    expect(trades[0]!.side).toBe("buy"); // paid token1 -> buying token0
    expect(trades[0]!.fee).toBe("2970");

    const takerAcct = accountSummary(db, TAKER);
    expect(takerAcct.markets[0]!.feesPaidTaker).toBe("2970");
  });

  it("models the claim-token (NFT) flow: mint then transfer", () => {
    // claim token 7 minted to Alice, then transferred to Carol
    const carolAcct = accountSummary(db, CAROL);
    const tok = carolAcct.claimTokens.find((t) => t.tokenId === "7");
    expect(tok).toBeDefined();
    expect(tok!.wrapper).toBe(NFT);

    const aliceAcct = accountSummary(db, ALICE);
    expect(aliceAcct.claimTokens.find((t) => t.tokenId === "7")).toBeUndefined();
  });

  it("is idempotent: re-applying the batch does not double-count", () => {
    applyBatch(db, sampleEvents);
    expect(listTrades(db, { market: BOOK })).toHaveLength(1);
    // fills are unique on (market, block, logIndex)
    const fillCount = (db.prepare("SELECT COUNT(*) AS c FROM fills").get() as { c: number }).c;
    expect(fillCount).toBe(2);
  });
});
