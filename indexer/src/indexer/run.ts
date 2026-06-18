// Standalone indexer process (no API). Useful for running the writer and the
// API on separate hosts against a shared SQLite file or for backfills.

import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { openDb } from "../db/index.js";
import { loadConfig } from "../config.js";
import { seedMarkets } from "../seed.js";
import { Bus } from "../bus.js";
import { Indexer } from "./indexer.js";

async function main() {
  const cfg = loadConfig();
  if (cfg.dbPath !== ":memory:") {
    try {
      mkdirSync(dirname(cfg.dbPath), { recursive: true });
    } catch {
      /* exists */
    }
  }
  const db = openDb(cfg.dbPath);
  seedMarkets(db, cfg);
  const indexer = new Indexer({ db, config: cfg, bus: new Bus() });

  const once = process.argv.includes("--once");
  if (once) {
    await indexer.syncOnce();
    console.log("[indexer] one-shot sync complete");
    db.close();
    return;
  }
  indexer.start();
  console.log(`[indexer] watching on ${cfg.rpcUrl}`);
  process.on("SIGINT", () => {
    indexer.stop();
    db.close();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error("[indexer] fatal:", err);
  process.exit(1);
});
