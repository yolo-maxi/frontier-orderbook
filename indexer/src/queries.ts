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
  const rows = db
    .prepare(
      `SELECT lower_tick, upper_tick, liquidity, is_bid
       FROM positions WHERE market = ? AND live = 1`,
    )
    .all(lc(market)) as Array<{
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
    for (let t = r.lower_tick; t < r.upper_tick; t += spacing) {
      target.set(t, (target.get(t) ?? 0n) + size);
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
}

export function listTrades(db: DB, f: TradeFilter = {}) {
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
  const limit = Math.min(Math.max(f.limit ?? 100, 1), 1000);
  const rows = db
    .prepare(
      `SELECT market, taker, token, gross_input, fee, total_paid, side,
              block_number, log_index, tx_hash, ts
       FROM trades
       ${where.length ? "WHERE " + where.join(" AND ") : ""}
       ORDER BY block_number DESC, log_index DESC
       LIMIT ?`,
    )
    .all(...params, limit) as any[];
  return rows.map((r) => ({
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
  }));
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
