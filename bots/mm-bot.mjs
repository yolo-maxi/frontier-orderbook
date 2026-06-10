// Frontier MM bot: quotes ETH-USDC at ±0.1% around the live Coinbase price.
// Demonstrates delegatable permissions: positions are OWNED by the mm key,
// while fast-path requotes are signed by a separate OPERATOR key holding
// selector-scoped grants in the PermissionRegistry. Fills force the slow
// path (settle via owner: cancel -> repost), exactly like a real desk.
import { deployment, pub, wallet, bookAbi, erc20Abi, registryAbi, priceToTick, tickToPrice, ethUsd, log } from './lib.mjs';
import { toFunctionSelector } from 'viem';

const OWNER_PK = process.env.MM_OWNER_PK || '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
const OPERATOR_PK = process.env.MM_OPERATOR_PK || '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a';

const SPREAD = 0.001; // ±0.1%
const LADDER_TICKS = 1000; // 1000 thin levels per side (= $1 of depth)
const SIZE = 2_000_000_000_000_000n; // 0.002 WETH per level

const { book, registry, weth, usdc } = deployment.contracts;
const owner = wallet(OWNER_PK);
const operator = wallet(OPERATOR_PK);

let askId = 0n, bidId = 0n, lastPrice = 4000;

const write = async (w, address, abi, functionName, args) => {
  const hash = await w.client.writeContract({ address, abi, functionName, args });
  const rcpt = await pub.waitForTransactionReceipt({ hash });
  if (rcpt.status !== 'success') throw new Error(`${functionName} reverted`);
  return rcpt;
};

async function setup() {
  log('mm', 'owner', owner.account.address, 'operator', operator.account.address);
  await write(owner, weth, erc20Abi, 'mint', [owner.account.address, 10_000n * 10n ** 18n]);
  await write(owner, usdc, erc20Abi, 'mint', [owner.account.address, 40_000_000n * 10n ** 18n]);
  await write(owner, weth, erc20Abi, 'approve', [book, 2n ** 255n]);
  await write(owner, usdc, erc20Abi, 'approve', [book, 2n ** 255n]);
  // delegate ONLY requote rights to the operator key
  for (const sig of ['function requote(uint256,int24,int24,uint128)', 'function requoteBid(uint256,int24,int24,uint128)']) {
    await write(owner, registry, registryAbi, 'grant', [operator.account.address, book, toFunctionSelector(sig)]);
  }
  log('mm', 'operator granted requote+requoteBid via PermissionRegistry');
}

async function settleAndRepost(targetTick, offset) {
  // owner path: settle fills, recenter pointer through the (now empty) spread, repost
  if (askId) { try { await write(owner, book, bookAbi, 'cancel', [askId]); } catch {} askId = 0n; }
  if (bidId) { try { await write(owner, book, bookAbi, 'cancelBid', [bidId]); } catch {} bidId = 0n; }
  const cur = await pub.readContract({ address: book, abi: bookAbi, functionName: 'currentTick' });
  if (Math.abs(Number(cur) - targetTick) > offset) {
    try { await write(owner, book, bookAbi, 'moveTickTo', [targetTick]); } catch (e) { log('mm', 'recenter blocked (live liquidity in path)'); }
  }
  const askLo = targetTick + offset, bidHi = targetTick - offset;
  const r1 = await pub.simulateContract({ address: book, abi: bookAbi, functionName: 'deposit', args: [askLo, askLo + LADDER_TICKS, SIZE], account: owner.account });
  askId = r1.result; await write(owner, book, bookAbi, 'deposit', [askLo, askLo + LADDER_TICKS, SIZE]);
  const r2 = await pub.simulateContract({ address: book, abi: bookAbi, functionName: 'depositBid', args: [bidHi - LADDER_TICKS, bidHi, SIZE], account: owner.account });
  bidId = r2.result; await write(owner, book, bookAbi, 'depositBid', [bidHi - LADDER_TICKS, bidHi, SIZE]);
  log('mm', `reposted around $${tickToPrice(targetTick).toFixed(2)} ask@${tickToPrice(askLo).toFixed(3)} bid@${tickToPrice(bidHi).toFixed(3)} (owner path)`);
}

async function tick() {
  const price = await ethUsd(lastPrice);
  lastPrice = price;
  const t = priceToTick(price);
  const offset = Math.max(10, Math.round(price * SPREAD * 1000)); // ±0.1% in ticks

  if (!askId || !bidId) return settleAndRepost(t, offset);

  // fast path: operator requotes (delegated, no custody)
  try {
    const askLo = t + offset, bidHi = t - offset;
    await write(operator, book, bookAbi, 'requote', [askId, askLo, askLo + LADDER_TICKS, SIZE]);
    await write(operator, book, bookAbi, 'requoteBid', [bidId, bidHi - LADDER_TICKS, bidHi, SIZE]);
    log('mm', `requoted $${price.toFixed(2)} ±0.1% (operator fast path)`);
  } catch (e) {
    log('mm', 'fast path blocked (fills or pointer) -> settling via owner');
    await settleAndRepost(t, offset);
  }
}

await setup();
await tick();
setInterval(() => tick().catch((e) => log('mm', 'tick error:', e.message?.slice(0, 120))), 12_000);
