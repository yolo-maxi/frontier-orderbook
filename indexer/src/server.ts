// Combined entrypoint: opens the DB, starts the persistent indexer (best
// effort — survives an unreachable RPC), and serves the REST + WS API.

import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { openDb } from "./db/index.js";
import { loadConfig } from "./config.js";
import { seedMarkets } from "./seed.js";
import { Bus } from "./bus.js";
import { Indexer } from "./indexer/indexer.js";
import { buildApi } from "./api.js";

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

  const bus = new Bus();

  // Indexer runs in-process. If the RPC is unreachable it logs and retries;
  // the API stays up regardless.
  const indexer = new Indexer({ db, config: cfg, bus });
  if (cfg.rpcUrl && (cfg.books.length || cfg.factory)) {
    indexer.start();
    console.log(`[server] indexer watching ${cfg.books.length} book(s) on ${cfg.rpcUrl}`);
  } else {
    console.log("[server] no books/factory configured — API only (read-only DB)");
  }

  const app = buildApi({ db, bus, logger: false });
  await app.listen({ port: cfg.httpPort, host: "0.0.0.0" });
  console.log(`[server] REST+WS API on http://0.0.0.0:${cfg.httpPort}`);

  const shutdown = async () => {
    indexer.stop();
    await app.close();
    db.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("[server] fatal:", err);
  process.exit(1);
});
