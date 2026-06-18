// I2 — normalized schema for the Frontier orderbook indexer.
//
// Tables:
//   markets        one row per book (from BookCreated, or seeded from config)
//   positions      one row per book positionId (Deposit/Requote/Cancel/xfer)
//   fills          maker-side fill records (IntervalFilled / RunFilled)
//   trades         taker-side executions (TakerFee), the public trade tape
//   account_states rollup per (market, owner): live notional, realized PnL
//   claim_tokens   explicit claimTokenId <-> positionId flow (PositionNFT)
//   fees           maker/taker fee log (MakerFee / TakerFee accounting)
//   cursors        per (market, kind) last-indexed block for resumable sync
//
// All token amounts are stored as TEXT (decimal string of a uint256/int256)
// because SQLite has no native 256-bit integer. Ticks/clocks fit in INTEGER.

export const SCHEMA_SQL = /* sql */ `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS markets (
  address       TEXT PRIMARY KEY,              -- book address, lowercased
  token0        TEXT NOT NULL,
  token1        TEXT NOT NULL,
  tick_spacing  INTEGER NOT NULL,
  start_tick    INTEGER,
  creator       TEXT,
  hooks         TEXT,
  fee_recipient TEXT,
  maker_fee_bps INTEGER NOT NULL DEFAULT 0,
  taker_fee_bps INTEGER NOT NULL DEFAULT 0,
  current_tick  INTEGER,                        -- last reconciled current tick
  created_block INTEGER,
  nft_wrapper   TEXT                            -- FrontierPositionNFT, if known
);

CREATE TABLE IF NOT EXISTS positions (
  market        TEXT NOT NULL,
  position_id   TEXT NOT NULL,                  -- uint256 as decimal string
  owner         TEXT NOT NULL,
  lower_tick    INTEGER NOT NULL,
  upper_tick    INTEGER NOT NULL,
  liquidity     TEXT NOT NULL,                  -- size at lower (L0)
  is_bid        INTEGER NOT NULL DEFAULT 0,
  live          INTEGER NOT NULL DEFAULT 1,
  deposit_block INTEGER,
  updated_block INTEGER,
  claimed       TEXT NOT NULL DEFAULT '0',      -- cumulative proceeds1 claimed
  PRIMARY KEY (market, position_id)
);
CREATE INDEX IF NOT EXISTS idx_positions_owner ON positions(owner);
CREATE INDEX IF NOT EXISTS idx_positions_live  ON positions(market, live);

CREATE TABLE IF NOT EXISTS fills (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  market        TEXT NOT NULL,
  kind          TEXT NOT NULL,                  -- 'interval' | 'run'
  from_tick     INTEGER NOT NULL,               -- lowerTick / fromLevel
  to_boundary   INTEGER,                        -- RunFilled only
  liquidity     TEXT,                           -- IntervalFilled only
  start_size    TEXT,                           -- RunFilled only
  slope_per_level TEXT,                          -- RunFilled only
  proceeds1     TEXT,                           -- IntervalFilled only
  clock         INTEGER NOT NULL,
  block_number  INTEGER NOT NULL,
  log_index     INTEGER NOT NULL,
  tx_hash       TEXT NOT NULL,
  ts            INTEGER,                         -- block timestamp (seconds)
  UNIQUE (market, block_number, log_index)
);
CREATE INDEX IF NOT EXISTS idx_fills_market_block ON fills(market, block_number);
CREATE INDEX IF NOT EXISTS idx_fills_clock        ON fills(market, clock);

CREATE TABLE IF NOT EXISTS trades (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  market        TEXT NOT NULL,
  taker         TEXT NOT NULL,
  token         TEXT NOT NULL,                  -- fee token = taker input token
  gross_input   TEXT NOT NULL,
  fee           TEXT NOT NULL,
  total_paid    TEXT NOT NULL,
  side          TEXT,                            -- 'buy' | 'sell' | null
  block_number  INTEGER NOT NULL,
  log_index     INTEGER NOT NULL,
  tx_hash       TEXT NOT NULL,
  ts            INTEGER,
  UNIQUE (market, block_number, log_index)
);
CREATE INDEX IF NOT EXISTS idx_trades_market_block ON trades(market, block_number);
CREATE INDEX IF NOT EXISTS idx_trades_taker        ON trades(taker);

CREATE TABLE IF NOT EXISTS account_states (
  market           TEXT NOT NULL,
  owner            TEXT NOT NULL,
  live_positions   INTEGER NOT NULL DEFAULT 0,
  total_positions  INTEGER NOT NULL DEFAULT 0,
  proceeds_claimed TEXT NOT NULL DEFAULT '0',   -- sum of Claim.proceeds1
  principal_returned TEXT NOT NULL DEFAULT '0', -- sum of Cancel.principal0
  fees_paid_maker  TEXT NOT NULL DEFAULT '0',
  fees_paid_taker  TEXT NOT NULL DEFAULT '0',
  updated_block    INTEGER,
  PRIMARY KEY (market, owner)
);

-- Explicit claimTokenId token-flow: a tokenId in FrontierPositionNFT wraps a
-- book positionId. Ownership of the token IS the claim right on proceeds.
CREATE TABLE IF NOT EXISTS claim_tokens (
  wrapper       TEXT NOT NULL,                  -- FrontierPositionNFT address
  token_id      TEXT NOT NULL,                  -- ERC-721 tokenId
  market        TEXT,                           -- resolved book address
  position_id   TEXT,                           -- wrapped book positionId
  owner         TEXT NOT NULL,                  -- current token holder
  minted_block  INTEGER,
  updated_block INTEGER,
  burned        INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (wrapper, token_id)
);
CREATE INDEX IF NOT EXISTS idx_claim_tokens_owner ON claim_tokens(owner);

CREATE TABLE IF NOT EXISTS fees (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  market        TEXT NOT NULL,
  kind          TEXT NOT NULL,                  -- 'maker' | 'taker'
  account       TEXT NOT NULL,                  -- positionId owner / payer
  token         TEXT NOT NULL,
  gross         TEXT NOT NULL,
  fee           TEXT NOT NULL,
  net           TEXT NOT NULL,
  recipient     TEXT NOT NULL,
  block_number  INTEGER NOT NULL,
  log_index     INTEGER NOT NULL,
  tx_hash       TEXT NOT NULL,
  UNIQUE (market, block_number, log_index)
);

CREATE TABLE IF NOT EXISTS cursors (
  scope         TEXT PRIMARY KEY,               -- e.g. 'book:0xabc' / 'factory'
  last_block    INTEGER NOT NULL DEFAULT 0
);
`;
