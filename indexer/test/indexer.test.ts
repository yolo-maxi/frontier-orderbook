import { describe, it, expect } from "vitest";
import {
  encodeEventTopics,
  encodeAbiParameters,
  getAbiItem,
  type Log,
  type PublicClient,
} from "viem";
import { openDb } from "../src/db/index.js";
import { Indexer } from "../src/indexer/indexer.js";
import { getCursor } from "../src/db/index.js";
import { bookEventsAbi } from "../src/abi.js";
import { listMarkets, positionsByOwner } from "../src/queries.js";
import type { IndexerConfig } from "../src/config.js";

const BOOK = "0x00000000000000000000000000000000000000b0";
const ALICE = "0x000000000000000000000000000000000000a11c";

function depositLog(positionId: bigint, owner: string, block: bigint, logIndex: number): Log {
  const item = getAbiItem({ abi: bookEventsAbi, name: "Deposit" });
  const topics = encodeEventTopics({
    abi: bookEventsAbi,
    eventName: "Deposit",
    args: { positionId, owner: owner as `0x${string}` },
  });
  const nonIndexed = (item as any).inputs.filter((i: any) => !i.indexed);
  const data = encodeAbiParameters(nonIndexed, [100, 140, 1_000_000_000_000_000_000n]);
  return {
    address: BOOK,
    topics: topics as any,
    data,
    blockNumber: block,
    blockHash: "0x" + "0".repeat(64),
    logIndex,
    transactionHash: ("0x" + "a".repeat(64)) as `0x${string}`,
    transactionIndex: 0,
    removed: false,
  } as Log;
}

/** Mock viem client that serves logs from an in-memory list. */
function mockClient(opts: {
  head: bigint;
  logs: Log[];
  currentTick?: bigint;
  failWideRanges?: boolean;
}): PublicClient {
  return {
    getBlockNumber: async () => opts.head,
    getBlock: async ({ blockNumber }: { blockNumber: bigint }) => ({
      timestamp: 1_700_000_000n + blockNumber,
    }),
    getLogs: async ({ fromBlock, toBlock }: { fromBlock: bigint; toBlock: bigint }) => {
      // simulate a pre-Swept / restrictive RPC that rejects wide windows
      if (opts.failWideRanges && toBlock - fromBlock > 1n) {
        throw new Error("query returned more than 10000 results");
      }
      return opts.logs.filter((l) => l.blockNumber! >= fromBlock && l.blockNumber! <= toBlock);
    },
    readContract: async ({ functionName }: { functionName: string }) => {
      if (functionName === "currentTick") {
        if (opts.currentTick === undefined) throw new Error("no currentTick");
        return opts.currentTick;
      }
      throw new Error("unexpected readContract " + functionName);
    },
  } as unknown as PublicClient;
}

const baseConfig = (over: Partial<IndexerConfig> = {}): IndexerConfig => ({
  chainId: 1,
  rpcUrl: "http://localhost",
  books: [BOOK],
  nftWrappers: [],
  startBlock: 0n,
  batchSize: 5000n,
  pollIntervalMs: 1000,
  dbPath: ":memory:",
  httpPort: 0,
  ...over,
});

describe("Indexer (mock client replay)", () => {
  it("syncs logs, persists positions, and advances the cursor", async () => {
    const db = openDb(":memory:");
    const logs = [depositLog(1n, ALICE, 5n, 0), depositLog(2n, ALICE, 6n, 0)];
    const client = mockClient({ head: 10n, logs, currentTick: 120n });
    const ix = new Indexer({ db, config: baseConfig(), client, log: () => {} });

    await ix.syncOnce();

    expect(positionsByOwner(db, ALICE)).toHaveLength(2);
    expect(getCursor(db, `book:${BOOK}`)).toBe(10);
    expect(listMarkets(db)[0]!.currentTick).toBe(120);
  });

  it("handles pre-Swept / restrictive RPCs by shrinking the window", async () => {
    const db = openDb(":memory:");
    const logs = [depositLog(1n, ALICE, 3n, 0)];
    const client = mockClient({ head: 4n, logs, failWideRanges: true });
    const ix = new Indexer({ db, config: baseConfig({ batchSize: 5000n }), client, log: () => {} });

    await ix.syncOnce();

    expect(positionsByOwner(db, ALICE)).toHaveLength(1);
    expect(getCursor(db, `book:${BOOK}`)).toBe(4);
  });

  it("tolerates a book with no currentTick view (pre-Swept book)", async () => {
    const db = openDb(":memory:");
    const client = mockClient({ head: 2n, logs: [] }); // no currentTick
    const ix = new Indexer({ db, config: baseConfig(), client, log: () => {} });
    await expect(ix.syncOnce()).resolves.toBeUndefined();
    // market may be empty; cursor still advances
    expect(getCursor(db, `book:${BOOK}`)).toBe(2);
  });

  it("is resumable: a second pass with no new logs is a no-op", async () => {
    const db = openDb(":memory:");
    const logs = [depositLog(1n, ALICE, 5n, 0)];
    const client = mockClient({ head: 10n, logs, currentTick: 100n });
    const ix = new Indexer({ db, config: baseConfig(), client, log: () => {} });
    await ix.syncOnce();
    await ix.syncOnce();
    expect(positionsByOwner(db, ALICE)).toHaveLength(1);
  });
});
