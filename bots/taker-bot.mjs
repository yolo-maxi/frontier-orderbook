// Random taker flow: small market buys/sells through the FrontierRouter to
// generate fills, volume, and price movement on the demo book.
import { deployment, marketLabel, pub, wallet, erc20Abi, routerAbi, lensAbi, log, tickToPrice, chainDeadline } from './lib.mjs';

const PK = process.env.TAKER_PK || '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6';
const { book, router, lens, weth, usdc } = deployment.contracts;
const me = wallet(PK);

// hyper-active knobs (defaults preserve original behaviour)
const MIN_MS = Number(process.env.TAKER_MIN_MS || 8_000);
const MAX_MS = Number(process.env.TAKER_MAX_MS || 30_000); // = MIN + 22s default
const SIZE_MIN = Number(process.env.TAKER_SIZE_MIN || 0.001);
const SIZE_MAX = Number(process.env.TAKER_SIZE_MAX || 0.02);
const TAG = `taker:${marketLabel}`;

const write = async (address, abi, functionName, args) => {
  const hash = await me.client.writeContract({ address, abi, functionName, args });
  return pub.waitForTransactionReceipt({ hash });
};

async function setup() {
  await write(weth, erc20Abi, 'mint', [me.account.address, 1_000n * 10n ** 18n]);
  await write(usdc, erc20Abi, 'mint', [me.account.address, 4_000_000n * 10n ** 18n]);
  await write(weth, erc20Abi, 'approve', [router, 2n ** 255n]);
  await write(usdc, erc20Abi, 'approve', [router, 2n ** 255n]);
  log(TAG, 'ready', me.account.address);
}

async function trade() {
  const buying = Math.random() < 0.5;
  const size = BigInt(Math.floor((SIZE_MIN + Math.random() * (SIZE_MAX - SIZE_MIN)) * 1e18));
  const deadline = await chainDeadline(120);
  if (buying) {
    const amountIn = (size * 4100n); // generous USDC budget for the size
    const [q0] = await pub.readContract({ address: lens, abi: lensAbi, functionName: 'quoteBuy', args: [book, amountIn] });
    if (q0 === 0n) return log(TAG, 'no asks to buy');
    await write(router, routerAbi, 'swapExactTokensForTokens', [amountIn, 0n, [usdc, weth], me.account.address, deadline]);
    log(TAG, `bought ${(Number(q0) / 1e18).toFixed(5)} WETH`);
  } else {
    const [q1] = await pub.readContract({ address: lens, abi: lensAbi, functionName: 'quoteSell', args: [book, size, 4000n] });
    if (q1 === 0n) return log(TAG, 'no bids to hit');
    await write(router, routerAbi, 'swapExactTokensForTokens', [size, 0n, [weth, usdc], me.account.address, deadline]);
    log(TAG, `sold ${(Number(size) / 1e18).toFixed(5)} WETH for ~${(Number(q1) / 1e18).toFixed(2)} USDC`);
  }
}

await setup();
const loop = async () => {
  try { await trade(); } catch (e) { log(TAG, 'trade error:', e.message?.slice(0, 120)); }
  setTimeout(loop, MIN_MS + Math.random() * Math.max(0, MAX_MS - MIN_MS));
};
loop();
