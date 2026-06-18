import type { DB } from "./db/index.js";
import type { IndexerConfig } from "./config.js";

/**
 * Seed market stubs from config so the REST API has rows even before the
 * indexer catches up (and for pre-Swept deployments with no BookCreated log).
 */
export function seedMarkets(db: DB, cfg: IndexerConfig): void {
  const stmt = db.prepare(
    `INSERT INTO markets (address, token0, token1, tick_spacing)
     VALUES (?, '', '', 0)
     ON CONFLICT(address) DO NOTHING`,
  );
  for (const b of cfg.books) stmt.run(b);
}
