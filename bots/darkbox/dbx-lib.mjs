// DarkBox prediction-market demo swarm — shared lib.
//
// Targets the live ARC testnet binary market (geometric CLOB, price = 1.0001^tick,
// price == implied probability). Funds throwaway bot wallets from the deployer
// treasury (the authorized sUSDC minter), then runs makers + takers to generate
// realistic YES/NO activity. Testnet only. NEVER logs private keys.
import {
  createPublicClient,
  createWalletClient,
  http,
  defineChain,
  parseAbi,
  keccak256,
  toHex,
  formatUnits,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── deployment + env ────────────────────────────────────────────────────
export function loadDeployment() {
  const p = resolve(__dirname, "../../ui/public/deployment.json");
  return JSON.parse(readFileSync(p, "utf8"));
}

/** Parse a dotenv-style file into { NAME: value }. Values are kept in memory
 * only and never logged. */
export function loadEnvFile(path) {
  const out = {};
  let txt;
  try {
    txt = readFileSync(path, "utf8");
  } catch {
    return out;
  }
  for (const line of txt.split("\n")) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[m[1]] = v;
  }
  return out;
}

// ── chain / clients ─────────────────────────────────────────────────────
export function makeChain(deployment, rpcUrl) {
  return defineChain({
    id: deployment.chainId,
    name: deployment.name || "ARC Testnet",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  });
}

export function makePublic(chain, rpcUrl) {
  // 1s polling so waitForTransactionReceipt returns promptly (default 4s adds
  // big serial latency under load).
  return createPublicClient({ chain, transport: http(rpcUrl, { timeout: 15_000, retryCount: 2 }), pollingInterval: 1000 });
}

export const chainDeadline = async (pub, secs = 300) => (await pub.getBlock()).timestamp + BigInt(secs);

// ── ABIs ────────────────────────────────────────────────────────────────
export const bookAbi = parseAbi([
  "function currentTick() view returns (int24)",
  "function tickSpacing() view returns (int24)",
  "function deposit(int24 lower, int24 upper, uint128 liquidity) returns (uint256)",
  "function depositBid(int24 lower, int24 upper, uint128 liquidity) returns (uint256)",
  "function cancel(uint256 id) returns (uint256, uint256)",
  "function cancelBid(uint256 id) returns (uint256, uint256)",
  "function cancelWithWitness(uint256 id, int24 witness) returns (uint256, uint256)",
  "function cancelBidWithWitness(uint256 id, int24 witness) returns (uint256, uint256)",
  "function claim(uint256 id) returns (uint256)",
  "function claimBid(uint256 id) returns (uint256)",
  "function moveTickTo(int24 target)",
  "function sweepWithLimits(int24 target, uint256 maxFills, uint256 maxPay, uint256 minOut, uint256 deadline) returns (int24, uint256, uint256)",
  "function nextPositionId() view returns (uint256)",
  "function multicall(bytes[] data) returns (bytes[] results)",
  "function positions(uint256) view returns (address owner, int24 lower, int24 upper, uint128 liquidity, int128 slope, uint64 depositClock, int24 claimedUpper, bool live, bool isBid)",
  "event Deposit(uint256 indexed positionId, address indexed owner, int24 lower, int24 upper, uint128 liquidity)",
]);

export const erc20Abi = parseAbi([
  "function mint(address to, uint256 amount)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
]);

export const routerAbi = parseAbi([
  "function buyExactIn(address book, uint256 amount1In, uint256 minOut0, address to, uint256 deadline) returns (uint256, uint256)",
  "function sellExactIn(address book, uint256 amount0In, uint256 minOut1, address to, uint256 deadline) returns (uint256, uint256)",
]);

export const lensAbi = parseAbi([
  "function quoteBuy(address book, uint256 amount1In) view returns (uint256, uint256, int24)",
  "function quoteSell(address book, uint256 amount0In, uint256 maxLevels) view returns (uint256, uint256, int24)",
]);

export const marketAbi = parseAbi([
  "function split(uint256 amount, address receiver) returns (uint256, uint256)",
  "function merge(uint256 amount, address receiver) returns (uint256)",
  "function yesToken() view returns (address)",
  "function noToken() view returns (address)",
  "function status() view returns (uint8)",
]);

// ── geometric price model (1.0001^tick == implied probability) ───────────
const LN_BASE = Math.log(1.0001);
export const tickToPrice = (t) => Math.pow(1.0001, Number(t));
export const probToTick = (p) => Math.round(Math.log(Math.max(1e-6, Math.min(0.999999, p))) / LN_BASE);

// ── deterministic throwaway bot wallets ──────────────────────────────────
/** Derive N ephemeral testnet keys from a seed. These are throwaway demo
 * wallets funded with small testnet balances — reused across runs so funds
 * and approvals persist. Override the seed via DBX_BOT_SEED. */
export function deriveBotKeys(n, seed = "darkbox-arc-demo-swarm-v1") {
  const keys = [];
  for (let i = 0; i < n; i++) {
    keys.push(keccak256(toHex(`${seed}:${i}`)));
  }
  return keys;
}

/**
 * Wrap an account with a per-wallet send queue so its txs serialize (no nonce
 * races). Parallelism comes from running many wallets at once. viem fetches
 * the nonce per tx; serialized sending keeps that correct.
 */
export function makeBot(pk, chain, rpcUrl, pub) {
  const account = privateKeyToAccount(pk);
  const client = createWalletClient({ account, chain, transport: http(rpcUrl, { timeout: 15_000, retryCount: 1 }), pollingInterval: 1000 });
  let queue = Promise.resolve();
  const send = (address, abi, functionName, args, value) =>
    (queue = queue.then(
      async () => {
        const hash = await client.writeContract({ address, abi, functionName, args, ...(value ? { value } : {}) });
        const rcpt = await pub.waitForTransactionReceipt({ hash, timeout: 60_000 });
        if (rcpt.status !== "success") throw new Error(`${functionName} reverted`);
        return rcpt;
      },
      // keep the queue alive even if a prior tx rejected
      () => {},
    ));
  const sendValue = (to, value) =>
    (queue = queue.then(async () => {
      const hash = await client.sendTransaction({ to, value });
      await pub.waitForTransactionReceipt({ hash, timeout: 60_000 });
    }));
  return { account, client, send, sendValue, addr: account.address };
}

// ── misc ──────────────────────────────────────────────────────────────--
export const fmt6 = (x) => Number(formatUnits(x, 6));
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const rint = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
export const ts = () => new Date().toISOString().slice(11, 23);
export const log = (tag, ...a) => console.log(ts(), `[${tag}]`, ...a);
/** redact anything that looks like a 32-byte hex key before printing */
export const safe = (s) => String(s).replace(/0x[0-9a-fA-F]{64}/g, "0x<redacted-key>");
