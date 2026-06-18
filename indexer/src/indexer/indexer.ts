// I3 — persistent indexer.
//
// Watches book / factory / NFT-wrapper logs via viem getLogs polling, decodes
// them, and applies them to SQLite through the shared ingest layer. Designed
// for resumability (per-scope block cursors) and graceful operation against
// "pre-Swept" deployments — chains whose RPC predates eth_getLogs niceties or
// where the book has never been swept (no fills yet). It never assumes a log
// type exists; missing events simply yield empty batches.

import {
  createPublicClient,
  http,
  defineChain,
  type PublicClient,
  type Address,
} from "viem";
import type { DB } from "../db/index.js";
import { getCursor, setCursor } from "../db/index.js";
import { applyBatch, setClaimTokenMapping, reconcileClaimTokensFromDeposits } from "../ingest.js";
import {
  bookViewAbi,
  bookEventsAbi,
  factoryEventsAbi,
  positionNftEventsAbi,
  positionNftViewAbi,
  ZERO_ADDRESS,
} from "../abi.js";
import type { IndexerConfig } from "../config.js";
import type { Bus } from "../bus.js";
import { decodeLogs } from "./decode.js";

export interface IndexerDeps {
  db: DB;
  config: IndexerConfig;
  bus?: Bus;
  /** Override for tests; defaults to a viem http client. */
  client?: PublicClient;
  log?: (...args: unknown[]) => void;
}

export class Indexer {
  private db: DB;
  private cfg: IndexerConfig;
  private bus?: Bus;
  private _client: PublicClient | null;
  private log: (...a: unknown[]) => void;
  private books: Set<string>;
  private running = false;
  private timer: NodeJS.Timeout | null = null;

  constructor(deps: IndexerDeps) {
    this.db = deps.db;
    this.cfg = deps.config;
    this.bus = deps.bus;
    this.log = deps.log ?? ((...a) => console.log("[indexer]", ...a));
    this.books = new Set(this.cfg.books);
    // Lazy: an API-only server may construct an Indexer it never starts, so we
    // don't build the viem transport (which requires a URL) until first use.
    this._client = deps.client ?? null;
  }

  private get client(): PublicClient {
    if (!this._client) {
      this._client = createPublicClient({
        chain: defineChain({
          id: this.cfg.chainId,
          name: "Frontier",
          nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
          rpcUrls: { default: { http: [this.cfg.rpcUrl] } },
        }),
        transport: http(this.cfg.rpcUrl),
      }) as unknown as PublicClient;
    }
    return this._client;
  }

  /** Run one full sync pass over all scopes up to the chain head. */
  async syncOnce(): Promise<void> {
    const head = await this.client.getBlockNumber();

    // 1) discover new books from the factory, if configured
    if (this.cfg.factory) {
      await this.syncScope(`factory:${this.cfg.factory}`, this.cfg.factory as Address, head, "factory");
      // pull any newly created books into the watch set
      const rows = this.db.prepare("SELECT address FROM markets").all() as Array<{ address: string }>;
      for (const r of rows) this.books.add(r.address);
    }

    // 2) book events
    for (const book of this.books) {
      await this.syncScope(`book:${book}`, book as Address, head, "book");
      await this.reconcileBook(book as Address);
    }

    // 3) claim-token (NFT) events
    for (const wrapper of this.cfg.nftWrappers) {
      await this.syncScope(`nft:${wrapper}`, wrapper as Address, head, "nft");
    }

    // 4) resolve claim-token -> (market, positionId) mappings.
    await this.reconcileClaimTokens();
  }

  /**
   * Resolve claim_tokens rows that are missing their wrapped (market,
   * positionId). Strategy, cheapest first:
   *   1) pure-DB correlation via the mint tx's Deposit (no RPC),
   *   2) on-chain `bookPositionOf(tokenId)` view on the wrapper, then match the
   *      returned positionId to the book that holds it.
   * Tolerant of wrappers that don't expose the view (pre-Swept / partial ABI):
   * such tokens simply remain unresolved and are retried next pass.
   */
  async reconcileClaimTokens(): Promise<void> {
    // Step 1: free DB-only correlation.
    try {
      reconcileClaimTokensFromDeposits(this.db);
    } catch (err) {
      this.log("claim-token DB reconcile failed:", String(err));
    }

    // Step 2: on-chain read for whatever is still pending.
    const pending = this.db
      .prepare(
        `SELECT wrapper, token_id FROM claim_tokens
         WHERE position_id IS NULL AND burned = 0`,
      )
      .all() as Array<{ wrapper: string; token_id: string }>;
    if (!pending.length) return;

    const books = [...this.books];
    for (const ct of pending) {
      let positionId: bigint;
      try {
        positionId = (await this.client.readContract({
          address: ct.wrapper as Address,
          abi: positionNftViewAbi,
          functionName: "bookPositionOf",
          args: [BigInt(ct.token_id)],
        })) as bigint;
      } catch {
        // wrapper has no such view (or RPC down) — leave pending, retry later
        continue;
      }
      const pid = positionId.toString();

      // Which book holds this positionId? Prefer an indexed position row; if
      // none yet, fall back to probing each book's positions(id) view to see
      // whether the id is live there.
      let market = this.bookForPosition(pid);
      if (!market) market = await this.probeBookForPosition(books, pid);
      if (market) {
        setClaimTokenMapping(this.db, ct.wrapper, ct.token_id, market, pid);
      }
    }
  }

  /** Find which indexed book already has a row for this positionId, if any. */
  private bookForPosition(positionId: string): string | null {
    const rows = this.db
      .prepare("SELECT market FROM positions WHERE position_id = ?")
      .all(positionId) as Array<{ market: string }>;
    return rows.length === 1 ? rows[0]!.market : null;
  }

  /** On-chain probe: which configured book reports a non-zero owner for id? */
  private async probeBookForPosition(books: string[], positionId: string): Promise<string | null> {
    for (const book of books) {
      try {
        const res = (await this.client.readContract({
          address: book as Address,
          abi: bookViewAbi,
          functionName: "positions",
          args: [BigInt(positionId)],
        })) as readonly unknown[];
        const owner = String(res[0]).toLowerCase();
        if (owner && owner !== ZERO_ADDRESS) return book;
      } catch {
        // book lacks the view or id unknown there — try the next
      }
    }
    return null;
  }

  private eventsFor(source: "book" | "factory" | "nft") {
    if (source === "book") return bookEventsAbi;
    if (source === "factory") return factoryEventsAbi;
    return positionNftEventsAbi;
  }

  private async syncScope(
    scope: string,
    address: Address,
    head: bigint,
    source: "book" | "factory" | "nft",
  ): Promise<void> {
    let from = BigInt(getCursor(this.db, scope));
    if (from === 0n) from = this.cfg.startBlock;
    if (from > head) return;

    while (from <= head) {
      const to = from + this.cfg.batchSize - 1n > head ? head : from + this.cfg.batchSize - 1n;
      let logs;
      try {
        logs = await this.client.getLogs({
          address,
          events: this.eventsFor(source) as any,
          fromBlock: from,
          toBlock: to,
          strict: false,
        });
      } catch (err) {
        // Pre-Swept / restrictive RPCs may reject wide ranges or unknown
        // topics. Halve the window and retry; if a single block still fails,
        // skip it so the indexer makes forward progress.
        if (to > from) {
          const mid = from + (to - from) / 2n;
          this.cfg.batchSize = mid - from + 1n > 1n ? mid - from + 1n : 1n;
          this.log(`getLogs failed for ${scope} [${from},${to}], shrinking window`, String(err));
          continue;
        }
        this.log(`skipping block ${from} for ${scope}:`, String(err));
        setCursor(this.db, scope, Number(from));
        from += 1n;
        continue;
      }

      if (logs.length) {
        const ts = await this.timestamps(logs.map((l) => l.blockNumber).filter(Boolean) as bigint[]);
        const decoded = decodeLogs(source, logs as any, ts);
        applyBatch(this.db, decoded, this.bus);
        this.log(`${scope}: applied ${decoded.length} events [${from},${to}]`);
      }
      setCursor(this.db, scope, Number(to));
      from = to + 1n;
    }
  }

  private async timestamps(blocks: bigint[]): Promise<Map<string, number>> {
    const uniq = [...new Set(blocks.map((b) => b.toString()))];
    const map = new Map<string, number>();
    await Promise.all(
      uniq.map(async (b) => {
        try {
          const blk = await this.client.getBlock({ blockNumber: BigInt(b) });
          map.set(b, Number(blk.timestamp));
        } catch {
          // best-effort; timestamps are optional metadata
        }
      }),
    );
    return map;
  }

  /** Reconcile current tick (and survive books that don't expose it). */
  private async reconcileBook(book: Address): Promise<void> {
    try {
      const tick = await this.client.readContract({
        address: book,
        abi: bookViewAbi,
        functionName: "currentTick",
      });
      this.db
        .prepare("UPDATE markets SET current_tick = ? WHERE address = ?")
        .run(Number(tick), book.toLowerCase());
    } catch {
      // pre-Swept book or unreachable view — leave current_tick as-is
    }
  }

  /** Start the poll loop. Resolves immediately; runs until stop(). */
  start(): void {
    if (this.running) return;
    this.running = true;
    const loop = async () => {
      if (!this.running) return;
      try {
        await this.syncOnce();
      } catch (err) {
        this.log("sync pass failed:", String(err));
      }
      if (this.running) this.timer = setTimeout(loop, this.cfg.pollIntervalMs);
    };
    void loop();
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
