// Read model for the REST API. All amount columns come back as decimal
// strings so the HTTP layer never loses precision on uint256 values.

import type { DB } from "./db/index.js";

const lc = (s: string) => s.toLowerCase();

export interface Market {
  address: string;
  token0: string;
  token1: string;
  tickSpacing: number;
  startTick: number | null;
  currentTick: number | null;
  makerFeeBps: number;
  takerFeeBps: number;
  feeRecipient: string | null;
  hooks: string | null;
  createdBlock: number | null;
}

export function listMarkets(db: DB): Market[] {
  const rows = db
    .prepare(
      `SELECT address, token0, token1, tick_spacing, start_tick, current_tick,
              maker_fee_bps, taker_fee_bps, fee_recipient, hooks, created_block
       FROM markets ORDER BY created_block IS NULL, created_block ASC`,
    )
    .all() as any[];
  return rows.map(toMarket);
}

export function getMarket(db: DB, address: string): Market | null {
  const row = db
    .prepare(
      `SELECT address, token0, token1, tick_spacing, start_tick, current_tick,
              maker_fee_bps, taker_fee_bps, fee_recipient, hooks, created_block
       FROM markets WHERE address = ?`,
    )
    .get(lc(address)) as any;
  return row ? toMarket(row) : null;
}

function toMarket(r: any): Market {
  return {
    address: r.address,
    token0: r.token0,
    token1: r.token1,
    tickSpacing: r.tick_spacing,
    startTick: r.start_tick,
    currentTick: r.current_tick,
    makerFeeBps: r.maker_fee_bps,
    takerFeeBps: r.taker_fee_bps,
    feeRecipient: r.fee_recipient,
    hooks: r.hooks,
    createdBlock: r.created_block,
  };
}

export interface DepthLevel {
  tick: number;
  askSize: string; // token0 resting (sum of live ask liquidity*levels at tick)
  bidSize: string; // token0-denominated bid size
}

/**
 * Hard caps for the depth reconstruction to keep it bounded regardless of how
 * many live positions exist or how wide any single range is. Without these the
 * scan is O(all live positions x all ticks they span), which a single
 * adversarial wide-range deposit could blow up.
 */
export const DEPTH_MAX_POSITIONS = 10_000;
/** Max ticks any single position is expanded over (defensive per-row bound). */
export const DEPTH_MAX_LEVELS_PER_POSITION = 100_000;

/**
 * Depth snapshot reconstructed from live positions. This is an indexed
 * approximation of FrontierLens.depth: for each live position we add its
 * per-level liquidity to every tick in [lower, upper). Slope-shaped ladders
 * are not modeled here (geometric/uniform book emits flat sizes), matching
 * the production book where shapes are archived.
 */
export function depthSnapshot(db: DB, market: string, maxLevels = 200): {
  market: string;
  currentTick: number | null;
  bids: DepthLevel[];
  asks: DepthLevel[];
} {
  const m = getMarket(db, market);
  const spacing = m?.tickSpacing && m.tickSpacing > 0 ? m.tickSpacing : 1;
  // Cap the number of live positions scanned. Ordered newest-first so the most
  // relevant liquidity is always included if the cap is hit.
  const rows = db
    .prepare(
      `SELECT lower_tick, upper_tick, liquidity, is_bid
       FROM positions WHERE market = ? AND live = 1
       ORDER BY deposit_block DESC, position_id DESC
       LIMIT ?`,
    )
    .all(lc(market), DEPTH_MAX_POSITIONS) as Array<{
    lower_tick: number;
    upper_tick: number;
    liquidity: string;
    is_bid: number;
  }>;

  const asks = new Map<number, bigint>();
  const bids = new Map<number, bigint>();
  for (const r of rows) {
    const size = BigInt(r.liquidity);
    const target = r.is_bid ? bids : asks;
    // Defensive per-row cap: never expand a single position over more than
    // DEPTH_MAX_LEVELS_PER_POSITION ticks even if its range is enormous.
    let levels = 0;
    for (let t = r.lower_tick; t < r.upper_tick; t += spacing) {
      target.set(t, (target.get(t) ?? 0n) + size);
      if (++levels >= DEPTH_MAX_LEVELS_PER_POSITION) break;
    }
  }

  const toLevels = (m2: Map<number, bigint>, side: "ask" | "bid"): DepthLevel[] =>
    [...m2.entries()]
      .map(([tick, size]) => ({
        tick,
        askSize: side === "ask" ? size.toString() : "0",
        bidSize: side === "bid" ? size.toString() : "0",
      }))
      .sort((a, b) => (side === "ask" ? a.tick - b.tick : b.tick - a.tick))
      .slice(0, maxLevels);

  return {
    market: lc(market),
    currentTick: m?.currentTick ?? null,
    bids: toLevels(bids, "bid"),
    asks: toLevels(asks, "ask"),
  };
}

export interface PositionRow {
  market: string;
  positionId: string;
  owner: string;
  lowerTick: number;
  upperTick: number;
  liquidity: string;
  isBid: boolean;
  live: boolean;
  claimed: string;
  depositBlock: number | null;
  claimToken?: { wrapper: string; tokenId: string; owner: string } | null;
}

export function positionsByOwner(db: DB, owner: string, includeClosed = true): PositionRow[] {
  const rows = db
    .prepare(
      `SELECT market, position_id, owner, lower_tick, upper_tick, liquidity,
              is_bid, live, claimed, deposit_block
       FROM positions
       WHERE owner = ? ${includeClosed ? "" : "AND live = 1"}
       ORDER BY deposit_block DESC, position_id DESC`,
    )
    .all(lc(owner)) as any[];
  return rows.map((r) => attachClaimToken(db, toPosition(r)));
}

function toPosition(r: any): PositionRow {
  return {
    market: r.market,
    positionId: r.position_id,
    owner: r.owner,
    lowerTick: r.lower_tick,
    upperTick: r.upper_tick,
    liquidity: r.liquidity,
    isBid: !!r.is_bid,
    live: !!r.live,
    claimed: r.claimed,
    depositBlock: r.deposit_block,
  };
}

function attachClaimToken(db: DB, p: PositionRow): PositionRow {
  const ct = db
    .prepare(
      `SELECT wrapper, token_id, owner FROM claim_tokens
       WHERE market = ? AND position_id = ? AND burned = 0`,
    )
    .get(p.market, p.positionId) as any;
  p.claimToken = ct ? { wrapper: ct.wrapper, tokenId: ct.token_id, owner: ct.owner } : null;
  return p;
}

export interface TradeFilter {
  market?: string;
  taker?: string;
  side?: "buy" | "sell";
  fromBlock?: number;
  toBlock?: number;
  limit?: number;
  /**
   * Opaque keyset cursor from a prior page (`page.nextCursor`). When present,
   * results continue strictly after this position in the (block, logIndex)
   * ordering, so pagination is stable even as new trades are appended.
   */
  cursor?: string;
}

export interface Trade {
  id: number;
  market: string;
  taker: string;
  token: string;
  grossInput: string;
  fee: string;
  totalPaid: string;
  side: string | null;
  blockNumber: number;
  logIndex: number;
  txHash: string;
  timestamp: number | null;
}

export interface Page<T> {
  items: T[];
  /** Opaque cursor to pass back as `cursor` for the next page, or null at end. */
  nextCursor: string | null;
}

function toTrade(r: any): Trade {
  return {
    id: r.id,
    market: r.market,
    taker: r.taker,
    token: r.token,
    grossInput: r.gross_input,
    fee: r.fee,
    totalPaid: r.total_paid,
    side: r.side,
    blockNumber: r.block_number,
    logIndex: r.log_index,
    txHash: r.tx_hash,
    timestamp: r.ts,
  };
}

// Keyset cursors encode the (block_number, log_index) of the last row of a
// page. base64url-encoded so they are opaque and URL-safe for clients.
function encodeCursor(block: number, logIndex: number): string {
  return Buffer.from(`${block}:${logIndex}`, "utf8").toString("base64url");
}

function decodeCursor(cursor: string): { block: number; logIndex: number } | null {
  try {
    const [b, l] = Buffer.from(cursor, "base64url").toString("utf8").split(":");
    const block = Number(b);
    const logIndex = Number(l);
    if (!Number.isFinite(block) || !Number.isFinite(logIndex)) return null;
    return { block, logIndex };
  } catch {
    return null;
  }
}

/**
 * Cursor-paginated trade tape, newest first. The returned `nextCursor` is a
 * stable keyset over (block_number, log_index); pass it back as `cursor` to
 * fetch the following page. Filters (market/taker/side/block range) are applied
 * before pagination.
 */
export function listTradesPage(db: DB, f: TradeFilter = {}): Page<Trade> {
  const where: string[] = [];
  const params: any[] = [];
  if (f.market) {
    where.push("market = ?");
    params.push(lc(f.market));
  }
  if (f.taker) {
    where.push("taker = ?");
    params.push(lc(f.taker));
  }
  if (f.side) {
    where.push("side = ?");
    params.push(f.side);
  }
  if (f.fromBlock !== undefined) {
    where.push("block_number >= ?");
    params.push(f.fromBlock);
  }
  if (f.toBlock !== undefined) {
    where.push("block_number <= ?");
    params.push(f.toBlock);
  }
  if (f.cursor) {
    const c = decodeCursor(f.cursor);
    if (c) {
      // strictly-before in (block DESC, logIndex DESC) ordering
      where.push("(block_number < ? OR (block_number = ? AND log_index < ?))");
      params.push(c.block, c.block, c.logIndex);
    }
  }
  const limit = Math.min(Math.max(f.limit ?? 100, 1), 1000);
  const rows = db
    .prepare(
      `SELECT id, market, taker, token, gross_input, fee, total_paid, side,
              block_number, log_index, tx_hash, ts
       FROM trades
       ${where.length ? "WHERE " + where.join(" AND ") : ""}
       ORDER BY block_number DESC, log_index DESC
       LIMIT ?`,
    )
    .all(...params, limit + 1) as any[];

  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit).map(toTrade);
  const last = page[page.length - 1];
  return {
    items: page,
    nextCursor: hasMore && last ? encodeCursor(last.blockNumber, last.logIndex) : null,
  };
}

/** Back-compat flat list (no pagination envelope). */
export function listTrades(db: DB, f: TradeFilter = {}): Trade[] {
  return listTradesPage(db, f).items;
}

// ---- Stats ----------------------------------------------------------------

export interface MarketStats {
  market: string;
  /** Window in seconds the stats cover (e.g. 86400 for 24h). */
  windowSecs: number;
  /** Lower bound (unix secs) of the window; null if no timestamped data. */
  since: number | null;
  /** Number of taker trades in the window. */
  tradeCount: number;
  /**
   * Taker gross input volume in the window, grouped by input token (decimal
   * strings). A buy and a sell pay in different tokens, so volume is reported
   * per-token rather than summed across incompatible denominations.
   */
  volumeByToken: Record<string, string>;
  /** token1 volume from interval fills (sum of proceeds1) in the window. */
  volume1: string;
  /** Fees paid by takers in the window, grouped by token (decimal strings). */
  feesByToken: Record<string, string>;
  /**
   * Open interest: token0-denominated resting liquidity across all live
   * positions (sum of liquidity * level-count), a point-in-time snapshot.
   */
  openInterest: string;
  /** Count of live positions backing the open interest. */
  livePositions: number;
}

const DAY_SECS = 86_400;

/**
 * 24h-style stats for a market: trade count, taker volume (per token), token1
 * fill volume, taker fees, and a point-in-time open-interest snapshot.
 * `windowSecs` defaults to 24h. The window upper bound is `now` (wall clock);
 * pass `now` for deterministic results in tests.
 */
export function marketStats(
  db: DB,
  market: string,
  windowSecs = DAY_SECS,
  now: number = Math.floor(Date.now() / 1000),
): MarketStats {
  const m = lc(market);
  const since = now - windowSecs;

  const trades = db
    .prepare(
      `SELECT token, gross_input, fee FROM trades
       WHERE market = ? AND ts IS NOT NULL AND ts >= ?`,
    )
    .all(m, since) as Array<{ token: string; gross_input: string; fee: string }>;

  const volumeByToken: Record<string, bigint> = {};
  const feesByToken: Record<string, bigint> = {};
  for (const t of trades) {
    volumeByToken[t.token] = (volumeByToken[t.token] ?? 0n) + BigInt(t.gross_input);
    feesByToken[t.token] = (feesByToken[t.token] ?? 0n) + BigInt(t.fee);
  }

  const vol1Row = db
    .prepare(
      `SELECT proceeds1 FROM fills
       WHERE market = ? AND kind = 'interval' AND ts IS NOT NULL AND ts >= ?`,
    )
    .all(m, since) as Array<{ proceeds1: string | null }>;
  let volume1 = 0n;
  for (const r of vol1Row) if (r.proceeds1) volume1 += BigInt(r.proceeds1);

  // Open interest from live positions: sum liquidity over every level it spans.
  const mk = getMarket(db, market);
  const spacing = mk?.tickSpacing && mk.tickSpacing > 0 ? mk.tickSpacing : 1;
  const live = db
    .prepare(
      `SELECT lower_tick, upper_tick, liquidity FROM positions
       WHERE market = ? AND live = 1`,
    )
    .all(m) as Array<{ lower_tick: number; upper_tick: number; liquidity: string }>;
  let openInterest = 0n;
  for (const p of live) {
    const levels = BigInt(Math.max(0, Math.floor((p.upper_tick - p.lower_tick) / spacing)));
    openInterest += BigInt(p.liquidity) * levels;
  }

  const strMap = (o: Record<string, bigint>): Record<string, string> =>
    Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v.toString()]));

  return {
    market: m,
    windowSecs,
    since,
    tradeCount: trades.length,
    volumeByToken: strMap(volumeByToken),
    volume1: volume1.toString(),
    feesByToken: strMap(feesByToken),
    openInterest: openInterest.toString(),
    livePositions: live.length,
  };
}

// ---- Candles / OHLC -------------------------------------------------------

export interface Candle {
  /** Bucket start, unix seconds (aligned to `interval`). */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  /** token1 volume traded in the bucket (sum of interval-fill proceeds1). */
  volume: string;
  /** Number of fills aggregated into this candle. */
  trades: number;
}

/** Convert a book tick to a floating price (token1 per token0): 1.0001^tick. */
export function tickToPrice(tick: number): number {
  return Math.pow(1.0001, tick);
}

export interface CandleQuery {
  market: string;
  /** Bucket size in seconds (e.g. 60, 300, 3600). */
  interval: number;
  from?: number;
  to?: number;
  limit?: number;
}

/**
 * OHLC candles derived from interval fills. Each interval fill carries the tick
 * at which it executed; price = 1.0001^tick. Fills are bucketed by block
 * timestamp into `interval`-second windows and reduced to open/high/low/close
 * plus token1 volume. Fills with no timestamp are skipped (no time axis).
 */
export function candles(db: DB, q: CandleQuery): Candle[] {
  const m = lc(q.market);
  const interval = Math.max(1, Math.floor(q.interval));
  const where: string[] = ["market = ?", "kind = 'interval'", "ts IS NOT NULL"];
  const params: any[] = [m];
  if (q.from !== undefined) {
    where.push("ts >= ?");
    params.push(q.from);
  }
  if (q.to !== undefined) {
    where.push("ts <= ?");
    params.push(q.to);
  }
  const rows = db
    .prepare(
      `SELECT from_tick, proceeds1, ts FROM fills
       WHERE ${where.join(" AND ")}
       ORDER BY ts ASC, block_number ASC, log_index ASC`,
    )
    .all(...params) as Array<{ from_tick: number; proceeds1: string | null; ts: number }>;

  const buckets = new Map<number, Candle>();
  for (const r of rows) {
    const bucket = Math.floor(r.ts / interval) * interval;
    const price = tickToPrice(r.from_tick);
    const vol = r.proceeds1 ? BigInt(r.proceeds1) : 0n;
    const c = buckets.get(bucket);
    if (!c) {
      buckets.set(bucket, {
        time: bucket,
        open: price,
        high: price,
        low: price,
        close: price,
        volume: vol.toString(),
        trades: 1,
      });
    } else {
      c.high = Math.max(c.high, price);
      c.low = Math.min(c.low, price);
      c.close = price;
      c.volume = (BigInt(c.volume) + vol).toString();
      c.trades += 1;
    }
  }

  const out = [...buckets.values()].sort((a, b) => a.time - b.time);
  const limit = Math.min(Math.max(q.limit ?? 1000, 1), 5000);
  // Keep the most recent `limit` candles.
  return out.length > limit ? out.slice(out.length - limit) : out;
}

export function accountSummary(db: DB, owner: string) {
  const o = lc(owner);
  const states = db
    .prepare(
      `SELECT market, live_positions, total_positions, proceeds_claimed,
              principal_returned, fees_paid_maker, fees_paid_taker, updated_block
       FROM account_states WHERE owner = ?`,
    )
    .all(o) as any[];
  const claimTokens = db
    .prepare(
      `SELECT wrapper, token_id, market, position_id FROM claim_tokens
       WHERE owner = ? AND burned = 0`,
    )
    .all(o) as any[];
  return {
    owner: o,
    markets: states.map((s) => ({
      market: s.market,
      livePositions: s.live_positions,
      totalPositions: s.total_positions,
      proceedsClaimed: s.proceeds_claimed,
      principalReturned: s.principal_returned,
      feesPaidMaker: s.fees_paid_maker,
      feesPaidTaker: s.fees_paid_taker,
      updatedBlock: s.updated_block,
    })),
    claimTokens: claimTokens.map((c) => ({
      wrapper: c.wrapper,
      tokenId: c.token_id,
      market: c.market,
      positionId: c.position_id,
    })),
  };
}
