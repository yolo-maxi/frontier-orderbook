// Random taker flow: small market buys/sells through the FrontierRouter to
// generate fills, volume, and price movement on the demo book.
import { deployment, pub, wallet, erc20Abi, routerAbi, lensAbi, log, tickToPrice, chainDeadline } from './lib.mjs';

const PK = process.env.TAKER_PK || '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6';
const { book, router, lens, weth, usdc } = deployment.contracts;
const me = wallet(PK);

const write = async (address, abi, functionName, args) => {
  const hash = await me.client.writeContract({ address, abi, functionName, args });
  return pub.waitForTransactionReceipt({ hash });
};

async function setup() {
  await write(weth, erc20Abi, 'mint', [me.account.address, 1_000n * 10n ** 18n]);
  await write(usdc, erc20Abi, 'mint', [me.account.address, 4_000_000n * 10n ** 18n]);
  await write(weth, erc20Abi, 'approve', [router, 2n ** 255n]);
  await write(usdc, erc20Abi, 'approve', [router, 2n ** 255n]);
  log('taker', 'ready', me.account.address);
}

async function trade() {
  const buying = Math.random() < 0.5;
  // 0.001 - 0.02 WETH equivalent
  const size = BigInt(Math.floor((0.001 + Math.random() * 0.019) * 1e18));
  const deadline = await chainDeadline(120);
  if (buying) {
    const amountIn = (size * 4100n); // generous USDC budget for the size
    const [q0] = await pub.readContract({ address: lens, abi: lensAbi, functionName: 'quoteBuy', args: [book, amountIn] });
    if (q0 === 0n) return log('taker', 'no asks to buy');
    await write(router, routerAbi, 'swapExactTokensForTokens', [amountIn, 0n, [usdc, weth], me.account.address, deadline]);
    log('taker', `bought ${(Number(q0) / 1e18).toFixed(5)} WETH`);
  } else {
    const [q1] = await pub.readContract({ address: lens, abi: lensAbi, functionName: 'quoteSell', args: [book, size, 4000n] });
    if (q1 === 0n) return log('taker', 'no bids to hit');
    await write(router, routerAbi, 'swapExactTokensForTokens', [size, 0n, [weth, usdc], me.account.address, deadline]);
    log('taker', `sold ${(Number(size) / 1e18).toFixed(5)} WETH for ~${(Number(q1) / 1e18).toFixed(2)} USDC`);
  }
}

await setup();
const loop = async () => {
  try { await trade(); } catch (e) { log('taker', 'trade error:', e.message?.slice(0, 120)); }
  setTimeout(loop, 8_000 + Math.random() * 22_000);
};
loop();
