import { describe, it, expect, beforeEach } from "vitest";
import type { PublicClient } from "viem";
import { openDb, type DB } from "../src/db/index.js";
import { applyBatch, reconcileClaimTokensFromDeposits } from "../src/ingest.js";
import { Indexer } from "../src/indexer/indexer.js";
import { positionsByOwner } from "../src/queries.js";
import type { DecodedEvent } from "../src/types.js";
import type { IndexerConfig } from "../src/config.js";

const BOOK = "0x00000000000000000000000000000000000000b0";
const NFT = "0x0000000000000000000000000000000000000fff";
const ALICE = "0x000000000000000000000000000000000000a11c";
const ZERO = "0x0000000000000000000000000000000000000000";

function deposit(positionId: bigint, owner: string, block: bigint): DecodedEvent {
  return {
    source: "book",
    eventName: "Deposit",
    address: BOOK as `0x${string}`,
    args: { positionId, owner, lower: 100n, upper: 140n, liquidity: 1_000_000_000_000_000_000n },
    blockNumber: block,
    logIndex: 0,
    transactionHash: ("0x" + "a".repeat(64)) as `0x${string}`,
    timestamp: 1_700_000_000 + Number(block),
  };
}

function mint(tokenId: bigint, to: string, block: bigint): DecodedEvent {
  return {
    source: "nft",
    eventName: "Transfer",
    address: NFT as `0x${string}`,
    args: { from: ZERO, to, tokenId },
    blockNumber: block,
    logIndex: 1,
    transactionHash: ("0x" + "b".repeat(64)) as `0x${string}`,
    timestamp: 1_700_000_000 + Number(block),
  };
}

function claimTokenRow(db: DB, tokenId: string) {
  return db
    .prepare("SELECT market, position_id, owner, burned FROM claim_tokens WHERE token_id = ?")
    .get(tokenId) as { market: string | null; position_id: string | null; owner: string; burned: number } | undefined;
}

describe("claim-token reconciliation (DB correlation fallback)", () => {
  let db: DB;
  beforeEach(() => {
    db = openDb(":memory:");
  });

  it("resolves market+positionId from a unique same-block deposit", () => {
    // Deposit position 5 and mint claim token 9 in the same block => 1:1 wrap.
    applyBatch(db, [deposit(5n, ALICE, 300n), mint(9n, ALICE, 300n)]);

    let row = claimTokenRow(db, "9");
    expect(row?.position_id).toBeNull(); // unresolved at ingest time

    const n = reconcileClaimTokensFromDeposits(db);
    expect(n).toBe(1);

    row = claimTokenRow(db, "9");
    expect(row?.market).toBe(BOOK);
    expect(row?.position_id).toBe("5");
  });

  it("leaves ambiguous tokens unresolved (multiple deposits same block)", () => {
    applyBatch(db, [deposit(5n, ALICE, 300n), deposit(6n, ALICE, 300n), mint(9n, ALICE, 301n)]);
    const n = reconcileClaimTokensFromDeposits(db);
    expect(n).toBe(0);
    expect(claimTokenRow(db, "9")?.position_id).toBeNull();
  });

  it("does not touch already-resolved or burned tokens", () => {
    applyBatch(db, [deposit(5n, ALICE, 300n), mint(9n, ALICE, 300n)]);
    reconcileClaimTokensFromDeposits(db);
    // second pass is a no-op (already resolved)
    expect(reconcileClaimTokensFromDeposits(db)).toBe(0);
  });
});

const baseConfig = (over: Partial<IndexerConfig> = {}): IndexerConfig => ({
  chainId: 1,
  rpcUrl: "http://localhost",
  books: [BOOK],
  nftWrappers: [NFT],
  startBlock: 0n,
  batchSize: 5000n,
  pollIntervalMs: 1000,
  dbPath: ":memory:",
  httpPort: 0,
  ...over,
});

/** Mock client that serves no logs but answers bookPositionOf / positions. */
function viewClient(opts: {
  head: bigint;
  bookPositionOf?: (tokenId: bigint) => bigint;
  positionOwner?: (positionId: bigint) => string;
}): PublicClient {
  return {
    getBlockNumber: async () => opts.head,
    getBlock: async ({ blockNumber }: { blockNumber: bigint }) => ({
      timestamp: 1_700_000_000n + blockNumber,
    }),
    getLogs: async () => [],
    readContract: async ({ functionName, args }: { functionName: string; args?: readonly unknown[] }) => {
      if (functionName === "currentTick") return 0n;
      if (functionName === "bookPositionOf") {
        if (!opts.bookPositionOf) throw new Error("no bookPositionOf view");
        return opts.bookPositionOf(args![0] as bigint);
      }
      if (functionName === "positions") {
        const owner = opts.positionOwner?.(args![0] as bigint) ?? ZERO;
        return [owner, 100, 140, 1n, 0n, 0n, 0, owner !== ZERO, false];
      }
      throw new Error("unexpected readContract " + functionName);
    },
  } as unknown as PublicClient;
}

describe("claim-token reconciliation (on-chain bookPositionOf)", () => {
  it("resolves via bookPositionOf + indexed position row", async () => {
    const db = openDb(":memory:");
    // position 42 already indexed (so bookForPosition finds the unique book),
    // claim token 9 minted at a block with no correlated deposit.
    applyBatch(db, [deposit(42n, ALICE, 100n), mint(9n, ALICE, 555n)]);

    const client = viewClient({ head: 10n, bookPositionOf: () => 42n });
    const ix = new Indexer({ db, config: baseConfig(), client, log: () => {} });
    await ix.reconcileClaimTokens();

    const row = claimTokenRow(db, "9");
    expect(row?.position_id).toBe("42");
    expect(row?.market).toBe(BOOK);
  });

  it("resolves via on-chain positions() probe when not yet indexed", async () => {
    const db = openDb(":memory:");
    // Only the mint is indexed; position 77 is not in the positions table yet,
    // so the reconciler must probe the book's positions(id) view.
    applyBatch(db, [mint(9n, ALICE, 555n)]);

    const client = viewClient({
      head: 10n,
      bookPositionOf: () => 77n,
      positionOwner: (id) => (id === 77n ? ALICE : ZERO),
    });
    const ix = new Indexer({ db, config: baseConfig(), client, log: () => {} });
    await ix.reconcileClaimTokens();

    const row = claimTokenRow(db, "9");
    expect(row?.position_id).toBe("77");
    expect(row?.market).toBe(BOOK);
  });

  it("leaves tokens pending when the wrapper has no view (pre-Swept)", async () => {
    const db = openDb(":memory:");
    applyBatch(db, [mint(9n, ALICE, 555n)]);
    const client = viewClient({ head: 10n }); // no bookPositionOf
    const ix = new Indexer({ db, config: baseConfig(), client, log: () => {} });
    await expect(ix.reconcileClaimTokens()).resolves.toBeUndefined();
    expect(claimTokenRow(db, "9")?.position_id).toBeNull();
  });

  it("syncOnce runs reconciliation end-to-end", async () => {
    const db = openDb(":memory:");
    applyBatch(db, [deposit(42n, ALICE, 100n), mint(9n, ALICE, 555n)]);
    expect(positionsByOwner(db, ALICE)).toHaveLength(1);

    const client = viewClient({ head: 10n, bookPositionOf: () => 42n });
    const ix = new Indexer({ db, config: baseConfig(), client, log: () => {} });
    await ix.syncOnce();

    expect(claimTokenRow(db, "9")?.position_id).toBe("42");
  });
});
