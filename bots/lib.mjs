import { createPublicClient, createWalletClient, http, defineChain, parseAbi } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { readFileSync } from 'fs';

export const deployment = JSON.parse(
  readFileSync(new URL('../prototype/deployments/latest.json', import.meta.url))
);

export const chain = defineChain({
  id: deployment.chainId,
  name: 'Frontier Devnet',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [process.env.RPC_URL || 'http://127.0.0.1:8547'] } },
});

export const pub = createPublicClient({ chain, transport: http() });

// deadline relative to CHAIN time: the devnet's instamine block timestamps
// run ahead of wall clocks, so Date.now()-based deadlines arrive expired
export const chainDeadline = async (secs = 120) =>
  (await pub.getBlock()).timestamp + BigInt(secs);
export const wallet = (pk) => {
  const account = privateKeyToAccount(pk);
  return { account, client: createWalletClient({ account, chain, transport: http() }) };
};

export const bookAbi = parseAbi([
  'function currentTick() view returns (int24)',
  'function deposit(int24 lower, int24 upper, uint128 liquidity) returns (uint256)',
  'function depositBid(int24 lower, int24 upper, uint128 liquidity) returns (uint256)',
  'function requote(uint256 id, int24 lower, int24 upper, uint128 liquidity)',
  'function requoteBid(uint256 id, int24 lower, int24 upper, uint128 liquidity)',
  'function cancel(uint256 id) returns (uint256, uint256)',
  'function cancelBid(uint256 id) returns (uint256, uint256)',
  'function moveTickTo(int24 target)',
  'function sweepWithLimits(int24 target, uint256 maxFills, uint256 maxPay, uint256 minOut, uint256 deadline) returns (int24, uint256, uint256)',
  'function claimable(uint256 id) view returns (uint256)',
  'function bidClaimable(uint256 id) view returns (uint256)',
  'function internalBalance0(address) view returns (uint256)',
  'function internalBalance1(address) view returns (uint256)',
  'function withdrawInternal(uint256 amount0, uint256 amount1)',
]);

export const erc20Abi = parseAbi([
  'function mint(address to, uint256 amount)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function balanceOf(address) view returns (uint256)',
]);

export const registryAbi = parseAbi([
  'function grant(address operator, address target, bytes4 selector)',
  'function isAuthorizedCall(address user, address operator, address target, bytes4 selector) view returns (bool)',
]);

export const routerAbi = parseAbi([
  'function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline) returns (uint256[])',
]);

export const lensAbi = parseAbi([
  'function quoteBuy(address book, uint256 amount1In) view returns (uint256, uint256, int24)',
  'function quoteSell(address book, uint256 amount0In, uint256 maxLevels) view returns (uint256, uint256, int24)',
]);

// price model: rate = 1 + 0.001*tick USDC/WETH
export const priceToTick = (p) => Math.round((p - 1) * 1000);
export const tickToPrice = (t) => 1 + 0.001 * Number(t);

export async function ethUsd(fallback) {
  try {
    const r = await fetch('https://api.coinbase.com/v2/prices/ETH-USD/spot', { signal: AbortSignal.timeout(5000) });
    const j = await r.json();
    const p = parseFloat(j.data.amount);
    if (p > 100 && p < 100000) return p;
  } catch {}
  // random walk fallback so the demo stays alive offline
  return fallback * (1 + (Math.random() - 0.5) * 0.0008);
}

export const log = (tag, ...args) => console.log(new Date().toISOString(), `[${tag}]`, ...args);
