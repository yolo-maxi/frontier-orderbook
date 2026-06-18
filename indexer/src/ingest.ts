// Pure ingest layer: applies decoded events to the SQLite DB.
//
// This is intentionally transport-agnostic. The live indexer (viem) and the
// replay/test harness both funnel DecodedEvent objects through `applyEvent`,
// so the exact same accounting code is exercised in production and in tests.

import type { DB } from "./db/index.js";
import type { DecodedEvent, EventEmitter } from "./types.js";
import { ZERO_ADDRESS } from "./abi.js";

const lc = (a: unknown): string => String(a).toLowerCase();
const str = (v: unknown): string => {
  if (typeof v === "bigint") return v.toString();
  return String(v);
};
const num = (v: unknown): number => Number(v as bigint | number);

/** Big-decimal add for the TEXT-stored uint256/int256 columns. */
function addStr(a: string, b: string): string {
  return (BigInt(a) + BigInt(b)).toString();
}

function ensureAccount(db: DB, market: string, owner: string, block: number): void {
  db.prepare(
    `INSERT INTO account_states (market, owner, updated_block)
     VALUES (?, ?, ?)
     ON CONFLICT(market, owner) DO NOTHING`,
  ).run(market, owner, block);
}

function bumpAccount(
  db: DB,
  market: string,
  owner: string,
  field: string,
  delta: string,
  block: number,
): void {
  // `field` is always a hard-coded column literal at the call sites; guard
  // anyway so the interpolation can never become an injection vector.
  const ALLOWED = new Set([
    "proceeds_claimed",
    "principal_returned",
    "fees_paid_maker",
    "fees_paid_taker",
  ]);
  if (!ALLOWED.has(field)) throw new Error(`bumpAccount: illegal field ${field}`);
  ensureAccount(db, market, owner, block);
  // big-int add done in JS, since the column is a uint256 stored as TEXT and
  // SQLite arithmetic would overflow its 64-bit integers.
  const row = db
    .prepare(`SELECT ${field} AS v FROM account_states WHERE market = ? AND owner = ?`)
    .get(market, owner) as { v: string };
  db.prepare(
    `UPDATE account_states SET ${field} = ?, updated_block = ? WHERE market = ? AND owner = ?`,
  ).run(addStr(row.v, delta), block, market, owner);
}

function recountAccount(db: DB, market: string, owner: string, block: number): void {
  ensureAccount(db, market, owner, block);
  const r = db
    .prepare(
      `SELECT
         SUM(CASE WHEN live = 1 THEN 1 ELSE 0 END) AS live,
         COUNT(*) AS total
       FROM positions WHERE market = ? AND owner = ?`,
    )
    .get(market, owner) as { live: number | null; total: number | null };
  db.prepare(
    `UPDATE account_states SET live_positions = ?, total_positions = ?, updated_block = ?
     WHERE market = ? AND owner = ?`,
  ).run(r.live ?? 0, r.total ?? 0, block, market, owner);
}

function ensureMarket(db: DB, address: string): void {
  // A book may be seeded from config before its BookCreated log is seen (or on
  // a pre-Swept deployment with no factory). Insert a stub so FK-free inserts
  // referencing the market never dangle.
  const exists = db.prepare("SELECT 1 FROM markets WHERE address = ?").get(address);
  if (!exists) {
    db.prepare(
      `INSERT INTO markets (address, token0, token1, tick_spacing)
       VALUES (?, '', '', 0)`,
    ).run(address);
  }
}

export interface ApplyResult {
  /** Channels to broadcast on (for the WS layer). */
  notifications: Array<{ channel: string; payload: unknown }>;
}

/**
 * Apply one decoded event. Idempotent on the (market, block, logIndex) key for
 * append-only tables; positions/accounts are last-writer-wins by block order.
 */
export function applyEvent(db: DB, ev: DecodedEvent, bus?: EventEmitter): ApplyResult {
  const block = num(ev.blockNumber);
  const notifications: Array<{ channel: string; payload: unknown }> = [];
  const market = lc(ev.address);

  switch (`${ev.source}:${ev.eventName}`) {
    case "factory:BookCreated": {
      const a = ev.args;
      db.prepare(
        `INSERT INTO markets
           (address, token0, token1, tick_spacing, start_tick, creator, hooks,
            fee_recipient, maker_fee_bps, taker_fee_bps, created_block)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(address) DO UPDATE SET
           token0 = excluded.token0, token1 = excluded.token1,
           tick_spacing = excluded.tick_spacing, start_tick = excluded.start_tick,
           creator = excluded.creator, hooks = excluded.hooks,
           fee_recipient = excluded.fee_recipient,
           maker_fee_bps = excluded.maker_fee_bps,
           taker_fee_bps = excluded.taker_fee_bps,
           created_block = excluded.created_block`,
      ).run(
        lc(a.book),
        lc(a.token0),
        lc(a.token1),
        num(a.tickSpacing),
        num(a.startTick),
        lc(a.creator),
        lc(a.hooks),
        lc(a.feeRecipient),
        num(a.makerFeeBps),
        num(a.takerFeeBps),
        block,
      );
      break;
    }

    case "book:Deposit": {
      ensureMarket(db, market);
      const a = ev.args;
      const owner = lc(a.owner);
      db.prepare(
        `INSERT INTO positions
           (market, position_id, owner, lower_tick, upper_tick, liquidity,
            is_bid, live, deposit_block, updated_block)
         VALUES (?, ?, ?, ?, ?, ?, 0, 1, ?, ?)
         ON CONFLICT(market, position_id) DO UPDATE SET
           owner = excluded.owner, lower_tick = excluded.lower_tick,
           upper_tick = excluded.upper_tick, liquidity = excluded.liquidity,
           live = 1, updated_block = excluded.updated_block`,
      ).run(market, str(a.positionId), owner, num(a.lower), num(a.upper), str(a.liquidity), block, block);
      recountAccount(db, market, owner, block);
      notifications.push({
        channel: "depth",
        payload: { market, kind: "deposit", positionId: str(a.positionId) },
      });
      break;
    }

    case "book:Requote": {
      ensureMarket(db, market);
      const a = ev.args;
      // Requote keeps the position id; owner unchanged. Update geometry/size.
      db.prepare(
        `UPDATE positions
           SET lower_tick = ?, upper_tick = ?, liquidity = ?, live = 1, updated_block = ?
         WHERE market = ? AND position_id = ?`,
      ).run(num(a.lower), num(a.upper), str(a.liquidity), block, market, str(a.positionId));
      notifications.push({
        channel: "depth",
        payload: { market, kind: "requote", positionId: str(a.positionId) },
      });
      break;
    }

    case "book:Cancel": {
      ensureMarket(db, market);
      const a = ev.args;
      const row = db
        .prepare("SELECT owner FROM positions WHERE market = ? AND position_id = ?")
        .get(market, str(a.positionId)) as { owner: string } | undefined;
      db.prepare(
        `UPDATE positions SET live = 0, updated_block = ? WHERE market = ? AND position_id = ?`,
      ).run(block, market, str(a.positionId));
      if (row) {
        bumpAccount(db, market, row.owner, "proceeds_claimed", str(a.proceeds1), block);
        bumpAccount(db, market, row.owner, "principal_returned", str(a.principal0), block);
        recountAccount(db, market, row.owner, block);
      }
      notifications.push({
        channel: "depth",
        payload: { market, kind: "cancel", positionId: str(a.positionId) },
      });
      break;
    }

    case "book:Claim": {
      ensureMarket(db, market);
      const a = ev.args;
      const row = db
        .prepare("SELECT owner, claimed FROM positions WHERE market = ? AND position_id = ?")
        .get(market, str(a.positionId)) as { owner: string; claimed: string } | undefined;
      if (row) {
        db.prepare(
          `UPDATE positions SET claimed = ?, updated_block = ? WHERE market = ? AND position_id = ?`,
        ).run(addStr(row.claimed, str(a.proceeds1)), block, market, str(a.positionId));
        bumpAccount(db, market, row.owner, "proceeds_claimed", str(a.proceeds1), block);
      }
      break;
    }

    case "book:PositionTransferred": {
      ensureMarket(db, market);
      const a = ev.args;
      const from = lc(a.from);
      const to = lc(a.to);
      db.prepare(
        `UPDATE positions SET owner = ?, updated_block = ? WHERE market = ? AND position_id = ?`,
      ).run(to, block, market, str(a.positionId));
      recountAccount(db, market, from, block);
      recountAccount(db, market, to, block);
      break;
    }

    case "book:IntervalFilled": {
      ensureMarket(db, market);
      const a = ev.args;
      db.prepare(
        `INSERT OR IGNORE INTO fills
           (market, kind, from_tick, liquidity, proceeds1, clock, block_number, log_index, tx_hash, ts)
         VALUES (?, 'interval', ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        market,
        num(a.lowerTick),
        str(a.liquidity),
        str(a.proceeds1),
        num(a.clock),
        block,
        ev.logIndex,
        ev.transactionHash,
        ev.timestamp ?? null,
      );
      notifications.push({
        channel: "fills",
        payload: {
          market,
          kind: "interval",
          tick: num(a.lowerTick),
          liquidity: str(a.liquidity),
          proceeds1: str(a.proceeds1),
          clock: num(a.clock),
          block,
        },
      });
      break;
    }

    case "book:RunFilled": {
      ensureMarket(db, market);
      const a = ev.args;
      db.prepare(
        `INSERT OR IGNORE INTO fills
           (market, kind, from_tick, to_boundary, start_size, slope_per_level, clock,
            block_number, log_index, tx_hash, ts)
         VALUES (?, 'run', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        market,
        num(a.fromLevel),
        num(a.toBoundary),
        str(a.startSize),
        str(a.slopePerLevel),
        num(a.clock),
        block,
        ev.logIndex,
        ev.transactionHash,
        ev.timestamp ?? null,
      );
      notifications.push({
        channel: "fills",
        payload: {
          market,
          kind: "run",
          fromLevel: num(a.fromLevel),
          toBoundary: num(a.toBoundary),
          startSize: str(a.startSize),
          slopePerLevel: str(a.slopePerLevel),
          clock: num(a.clock),
          block,
        },
      });
      break;
    }

    case "book:TakerFee": {
      ensureMarket(db, market);
      const a = ev.args;
      const payer = lc(a.payer);
      const token = lc(a.token);
      // side: input token == token0 => selling token0 (sell); else buy.
      const mk = db
        .prepare("SELECT token0 FROM markets WHERE address = ?")
        .get(market) as { token0: string } | undefined;
      let side: string | null = null;
      if (mk && mk.token0) side = token === mk.token0 ? "sell" : "buy";
      db.prepare(
        `INSERT OR IGNORE INTO trades
           (market, taker, token, gross_input, fee, total_paid, side,
            block_number, log_index, tx_hash, ts)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        market,
        payer,
        token,
        str(a.grossInput),
        str(a.fee),
        str(a.totalPaid),
        side,
        block,
        ev.logIndex,
        ev.transactionHash,
        ev.timestamp ?? null,
      );
      db.prepare(
        `INSERT OR IGNORE INTO fees
           (market, kind, account, token, gross, fee, net, recipient,
            block_number, log_index, tx_hash)
         VALUES (?, 'taker', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(market, payer, token, str(a.grossInput), str(a.fee), str(a.totalPaid), lc(a.recipient), block, ev.logIndex, ev.transactionHash);
      bumpAccount(db, market, payer, "fees_paid_taker", str(a.fee), block);
      notifications.push({
        channel: "fills",
        payload: { market, kind: "trade", taker: payer, side, grossInput: str(a.grossInput), block },
      });
      break;
    }

    case "book:MakerFee": {
      ensureMarket(db, market);
      const a = ev.args;
      const posRow = db
        .prepare("SELECT owner FROM positions WHERE market = ? AND position_id = ?")
        .get(market, str(a.positionId)) as { owner: string } | undefined;
      const account = posRow?.owner ?? ZERO_ADDRESS;
      db.prepare(
        `INSERT OR IGNORE INTO fees
           (market, kind, account, token, gross, fee, net, recipient,
            block_number, log_index, tx_hash)
         VALUES (?, 'maker', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(market, account, lc(a.token), str(a.grossProceeds), str(a.fee), str(a.netProceeds), lc(a.recipient), block, ev.logIndex, ev.transactionHash);
      if (posRow) bumpAccount(db, market, account, "fees_paid_maker", str(a.fee), block);
      break;
    }

    // ---- claimTokenId flow (FrontierPositionNFT ERC-721 Transfer) ----------
    case "nft:Transfer": {
      const a = ev.args;
      const wrapper = market; // the nft contract address
      const from = lc(a.from);
      const to = lc(a.to);
      const tokenId = str(a.tokenId);
      if (from === ZERO_ADDRESS) {
        // mint: a new claim token. position_id/market resolved later by the
        // reconciler (bookPositionOf view), since the Transfer log alone does
        // not carry the wrapped positionId.
        db.prepare(
          `INSERT INTO claim_tokens (wrapper, token_id, owner, minted_block, updated_block)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(wrapper, token_id) DO UPDATE SET
             owner = excluded.owner, burned = 0, updated_block = excluded.updated_block`,
        ).run(wrapper, tokenId, to, block, block);
      } else if (to === ZERO_ADDRESS) {
        // burn (unwrap): claim right returns to raw position.
        db.prepare(
          `UPDATE claim_tokens SET burned = 1, owner = ?, updated_block = ?
           WHERE wrapper = ? AND token_id = ?`,
        ).run(ZERO_ADDRESS, block, wrapper, tokenId);
      } else {
        db.prepare(
          `UPDATE claim_tokens SET owner = ?, updated_block = ?
           WHERE wrapper = ? AND token_id = ?`,
        ).run(to, block, wrapper, tokenId);
      }
      notifications.push({
        channel: "depth",
        payload: { wrapper, kind: "claimTokenTransfer", tokenId, from, to },
      });
      break;
    }

    default:
      // Unknown event: ignore (forward-compatible with new log types).
      break;
  }

  if (bus) {
    for (const n of notifications) bus.emit(n.channel, n.payload);
  }
  return { notifications };
}

/**
 * Apply a batch in a single transaction. Returns all notifications collected.
 */
export function applyBatch(db: DB, events: DecodedEvent[], bus?: EventEmitter): void {
  const all: Array<{ channel: string; payload: unknown }> = [];
  const txn = db.transaction((evs: DecodedEvent[]) => {
    for (const ev of evs) {
      const r = applyEvent(db, ev); // no bus inside txn
      all.push(...r.notifications);
    }
  });
  txn(events);
  if (bus) for (const n of all) bus.emit(n.channel, n.payload);
}
