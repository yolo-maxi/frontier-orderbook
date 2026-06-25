import {
  createPublicClient,
  createWalletClient,
  defineChain,
  formatUnits,
  http,
  parseAbi,
  parseUnits,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { readFileSync, writeFileSync } from 'fs';

export const deployment = JSON.parse(
  readFileSync(new URL('../prototype/deployments/base-sepolia-pm.json', import.meta.url), 'utf8'),
);

export const rpcUrl = process.env.RPC_URL || deployment.rpcUrl || 'https://sepolia.base.org';

export const chain = defineChain({
  id: deployment.chainId,
  name: deployment.name || 'Base Sepolia',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
});

export const pub = createPublicClient({
  chain,
  transport: http(rpcUrl, { timeout: 20_000, retryCount: 2 }),
  pollingInterval: 1000,
});

export const bookAbi = parseAbi([
  'function currentTick() view returns (int24)',
  'function tickSpacing() view returns (int24)',
  'function deposit(int24 lower, int24 upper, uint128 liquidity) returns (uint256)',
  'function depositBid(int24 lower, int24 upper, uint128 liquidity) returns (uint256)',
  'function requote(uint256 id, int24 lower, int24 upper, uint128 liquidity)',
  'function requoteBid(uint256 id, int24 lower, int24 upper, uint128 liquidity)',
  'function cancel(uint256 id) returns (uint256, uint256)',
  'function cancelBid(uint256 id) returns (uint256, uint256)',
  'function sweepWithLimits(int24 target, uint256 maxFills, uint256 maxPay, uint256 minOut, uint256 deadline) returns (int24, uint256, uint256)',
  'function positions(uint256) view returns (address owner, int24 lower, int24 upper, uint128 liquidity, uint64 depositClock, int24 claimedUpper, bool live, bool isBid)',
]);

export const erc20Abi = parseAbi([
  'function mint(address to, uint256 amount)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)',
]);

export const lensAbi = parseAbi([
  'function quoteBuy(address book, uint256 amount1In) view returns (uint256, uint256, int24)',
  'function quoteSell(address book, uint256 amount0In, uint256 maxLevels) view returns (uint256, uint256, int24)',
]);

export const registryAbi = parseAbi([
  'function grant(address operator, address target, bytes4 selector)',
  'function isAuthorizedCall(address user, address operator, address target, bytes4 selector) view returns (bool)',
]);

export const market = {
  book: deployment.contracts.book,
  router: deployment.contracts.router,
  lens: deployment.contracts.lens,
  registry: deployment.contracts.registry,
  base: deployment.contracts.weth,
  quote: deployment.contracts.usdc,
  baseSymbol: deployment.tokens?.base || 'YES',
  quoteSymbol: deployment.tokens?.quote || 'USDC',
  baseDecimals: deployment.tokens?.baseDecimals ?? 18,
  quoteDecimals: deployment.tokens?.quoteDecimals ?? 18,
};

export const tickSpacing = Number(deployment.tickSpacing || 60);
export const startTick = Number(deployment.startTick || -6900);
export const seededMinTick = alignTick(
  Number(process.env.BOT_MIN_TICK || startTick - 1200),
  tickSpacing,
  'down',
);
export const seededMaxTick = alignTick(
  Number(process.env.BOT_MAX_TICK || startTick + 1260),
  tickSpacing,
  'down',
);
export const fairMinTick = alignTick(
  Number(process.env.BOT_FAIR_MIN_TICK || seededMinTick + 180),
  tickSpacing,
  'up',
);
export const fairMaxTick = alignTick(
  Number(process.env.BOT_FAIR_MAX_TICK || seededMaxTick - 180),
  tickSpacing,
  'down',
);

export const TICK_BASE = 1.0001;
export const LN_BASE = Math.log(TICK_BASE);
export const MAX_UINT = 2n ** 256n - 1n;
export const ONE = 10n ** 18n;

export function tickToPrice(tick) {
  return Math.pow(TICK_BASE, Number(tick));
}

export function priceToTick(price, mode = 'nearest') {
  if (!(price > 0)) throw new Error(`invalid price ${price}`);
  return alignTick(Math.log(price) / LN_BASE, tickSpacing, mode);
}

export function alignTick(tick, spacing = tickSpacing, mode = 'nearest') {
  const n = Number(tick);
  if (mode === 'up') return Math.ceil(n / spacing) * spacing;
  if (mode === 'down') return Math.floor(n / spacing) * spacing;
  return Math.round(n / spacing) * spacing;
}

export function clampTick(tick, min = seededMinTick, max = seededMaxTick) {
  return Math.max(min, Math.min(max, alignTick(tick)));
}

export function formatCentsForTick(tick, dp = 2) {
  return `${(tickToPrice(tick) * 100).toFixed(dp)}c`;
}

export function toUnits(amount, decimals = 18) {
  return parseUnits(Number(amount).toFixed(6), decimals);
}

export function fromUnits(amount, decimals = 18, dp = 4) {
  return Number(formatUnits(amount, decimals)).toFixed(dp);
}

export function loadPrivateKey(envName, fileEnvName) {
  const value = process.env[envName];
  const file = process.env[fileEnvName];
  const raw = value || (file ? readFileSync(file, 'utf8') : '');
  const key = raw.trim().split(/\s+/)[0];
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) {
    throw new Error(`missing private key: set ${envName} or ${fileEnvName}`);
  }
  return key;
}

export function maybeLoadPrivateKey(envName, fileEnvName) {
  try {
    return loadPrivateKey(envName, fileEnvName);
  } catch {
    return null;
  }
}

export function makeWallet(pk) {
  const account = privateKeyToAccount(pk);
  const client = createWalletClient({
    account,
    chain,
    transport: http(rpcUrl, { timeout: 20_000, retryCount: 1 }),
    pollingInterval: 1000,
  });
  let queue = Promise.resolve();
  const queued = (fn) => {
    const next = queue.catch(() => {}).then(fn);
    queue = next.catch(() => {});
    return next;
  };
  const sendContract = (address, abi, functionName, args) =>
    queued(async () => {
      const hash = await client.writeContract({ address, abi, functionName, args });
      const receipt = await pub.waitForTransactionReceipt({ hash, timeout: 90_000 });
      if (receipt.status !== 'success') throw new Error(`${functionName} reverted: ${hash}`);
      return receipt;
    });
  const sendValue = (to, value) =>
    queued(async () => {
      const hash = await client.sendTransaction({ to, value });
      const receipt = await pub.waitForTransactionReceipt({ hash, timeout: 90_000 });
      if (receipt.status !== 'success') throw new Error(`sendTransaction reverted: ${hash}`);
      return receipt;
    });
  return { account, client, address: account.address, sendContract, sendValue };
}

export async function readCurrentTick() {
  return Number(await pub.readContract({ address: market.book, abi: bookAbi, functionName: 'currentTick' }));
}

export function wallDeadline(secs = 300) {
  return BigInt(Math.floor(Date.now() / 1000) + secs);
}

export async function ensureMintAndApproval(wallet, token, spender, mintAmount) {
  await wallet.sendContract(token, erc20Abi, 'mint', [wallet.address, mintAmount]);
  await wallet.sendContract(token, erc20Abi, 'approve', [spender, MAX_UINT]);
}

export async function simulateContract(account, address, abi, functionName, args) {
  return pub.simulateContract({ address, abi, functionName, args, account });
}

const statusUrl = process.env.HEARTBEAT_STATUS_URL || 'http://127.0.0.1:3392/status';

export async function presenceStatus() {
  try {
    const res = await fetch(statusUrl, { signal: AbortSignal.timeout(3000), cache: 'no-store' });
    if (!res.ok) return { active: false, error: `HTTP ${res.status}`, lastSeenSecsAgo: null };
    const body = await res.json();
    return {
      active: !!body.active,
      lastSeenSecsAgo: body.lastSeenSecsAgo ?? null,
      error: null,
    };
  } catch (e) {
    return { active: false, error: e.message || String(e), lastSeenSecsAgo: null };
  }
}

export function idleMessage(status) {
  if (status.error) return `idle/sleeping: heartbeat unavailable (${status.error})`;
  if (status.lastSeenSecsAgo === null) return 'idle/sleeping: no heartbeat yet';
  return `idle/sleeping: last heartbeat ${status.lastSeenSecsAgo}s ago`;
}

const fairStateUrl = new URL('./.fair-value.json', import.meta.url);

export function readFairState() {
  try {
    return JSON.parse(readFileSync(fairStateUrl, 'utf8'));
  } catch {
    return null;
  }
}

export function writeFairState(state) {
  writeFileSync(fairStateUrl, `${JSON.stringify(state, null, 2)}\n`);
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export const rand = (min, max) => min + Math.random() * (max - min);
export const randInt = (min, max) => min + Math.floor(Math.random() * (max - min + 1));
export const clamp = (x, min, max) => Math.max(min, Math.min(max, x));

export function normalish() {
  let sum = 0;
  for (let i = 0; i < 6; i++) sum += Math.random();
  return sum - 3;
}

export function safeError(e, limit = 140) {
  return String(e.shortMessage || e.message || e)
    .replace(/0x[0-9a-fA-F]{64}/g, '0x<redacted-key>')
    .slice(0, limit);
}

export const log = (tag, ...args) => console.log(new Date().toISOString(), `[${tag}]`, ...args);
