import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface IndexerConfig {
  chainId: number;
  rpcUrl: string;
  /** Books to index. If empty and a factory is set, discovered from logs. */
  books: string[];
  /** Factory to watch for BookCreated (optional). */
  factory?: string;
  /** FrontierPositionNFT wrapper(s) for the claim-token flow (optional). */
  nftWrappers: string[];
  /** Block to start syncing from when no cursor exists. */
  startBlock: bigint;
  /** Max blocks per getLogs request. */
  batchSize: bigint;
  /** Poll interval in ms. */
  pollIntervalMs: number;
  dbPath: string;
  httpPort: number;
}

/**
 * Build config from env vars, falling back to prototype/deployments/latest.json
 * for the devnet so the service runs with zero flags against the demo stack.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): IndexerConfig {
  let deployment: any = {};
  try {
    const p = resolve(__dirname, "../../prototype/deployments/latest.json");
    deployment = JSON.parse(readFileSync(p, "utf8"));
  } catch {
    // no deployment file (e.g. running standalone / in tests) — env only
  }

  const c = deployment.contracts ?? {};
  const books = (env.BOOKS ?? c.book ?? "")
    .split(",")
    .map((s: string) => s.trim().toLowerCase())
    .filter(Boolean);
  const nftWrappers = (env.NFT_WRAPPERS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  return {
    chainId: Number(env.CHAIN_ID ?? deployment.chainId ?? 0),
    rpcUrl: (env.RPC_URL || deployment.rpcUrl || "http://127.0.0.1:8545") as string,
    books,
    factory: (env.FACTORY ?? c.factory ?? "").toLowerCase() || undefined,
    nftWrappers,
    startBlock: BigInt(env.START_BLOCK ?? 0),
    batchSize: BigInt(env.BATCH_SIZE ?? 5000),
    pollIntervalMs: Number(env.POLL_INTERVAL_MS ?? 2500),
    dbPath: env.DB_PATH ?? resolve(__dirname, "../data/frontier.db"),
    httpPort: Number(env.PORT ?? 8787),
  };
}
