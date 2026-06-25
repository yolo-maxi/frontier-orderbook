// Presence-gated taker flow for the recentered YES/USDC geometric book.
//
// The taker reads the maker's fair-value state and sends randomized bounded
// sweeps toward it, with noisy direction and size so prints do not ping-pong.
import {
  ONE,
  bookAbi,
  clamp,
  ensureMintAndApproval,
  formatCentsForTick,
  fromUnits,
  idleMessage,
  loadPrivateKey,
  log,
  makeWallet,
  market,
  presenceStatus,
  pub,
  rand,
  randInt,
  readCurrentTick,
  readFairState,
  safeError,
  seededMaxTick,
  seededMinTick,
  simulateContract,
  sleep,
  tickSpacing,
  tickToPrice,
  toUnits,
  wallDeadline,
} from './lib.mjs';

const taker = makeWallet(loadPrivateKey('TAKER_PK', 'TAKER_PK_FILE'));

const LOOP_MIN_MS = Number(process.env.TAKER_LOOP_MIN_MS || 7_000);
const LOOP_MAX_MS = Number(process.env.TAKER_LOOP_MAX_MS || 19_000);
const IDLE_SLEEP_MS = Number(process.env.IDLE_SLEEP_MS || 5_000);
const INVENTORY_MINT = 500_000n * ONE;

let setupDone = false;
let idleLoggedAt = 0;

async function ensureSetup() {
  if (setupDone) return;
  log('taker', 'activating', taker.address);
  await ensureMintAndApproval(taker, market.base, market.book, INVENTORY_MINT);
  await ensureMintAndApproval(taker, market.quote, market.book, INVENTORY_MINT);
  setupDone = true;
  log('taker', `inventory minted/approved for ${market.baseSymbol}/${market.quoteSymbol}`);
}

function fairTickFallback(currentTick) {
  const state = readFairState();
  if (state && Number.isFinite(state.fairTick)) return Number(state.fairTick);
  return currentTick + randInt(-2, 2) * tickSpacing;
}

function chooseSide(currentTick, fairTick) {
  if (currentTick <= seededMinTick + tickSpacing * 2) return true;
  if (currentTick >= seededMaxTick - tickSpacing * 2) return false;
  const gap = fairTick - currentTick;
  const fairPressure = Math.tanh(gap / (tickSpacing * 3));
  const noise = rand(-0.18, 0.18);
  const buyProb = clamp(0.5 + fairPressure * 0.34 + noise, 0.18, 0.82);
  return Math.random() < buyProb;
}

function tradeSizeShares() {
  const base = rand(70, 260);
  const burst = Math.random() < 0.18 ? rand(90, 240) : 0;
  return base + burst;
}

async function trade() {
  await ensureSetup();
  const currentTick = await readCurrentTick();
  const fairTick = fairTickFallback(currentTick);
  const buying = chooseSide(currentTick, fairTick);
  const gapLevels = Math.ceil(Math.abs(fairTick - currentTick) / tickSpacing);
  const levels = clamp(gapLevels + randInt(2, Math.random() < 0.2 ? 5 : 3), 2, 9);
  const target = buying
    ? Math.min(seededMaxTick, currentTick + levels * tickSpacing)
    : Math.max(seededMinTick, currentTick - levels * tickSpacing);
  if (target === currentTick) return;

  const shares = tradeSizeShares();
  const deadline = wallDeadline(300);
  const maxFills = 48n;
  const amount = buying
    ? toUnits(shares * tickToPrice(currentTick) * rand(1.08, 1.38), market.quoteDecimals)
    : toUnits(shares, market.baseDecimals);
  const fnArgs = [target, maxFills, amount, 0n, deadline];
  const sim = await simulateContract(taker.account, market.book, bookAbi, 'sweepWithLimits', fnArgs);
  const [reached, paid, received] = sim.result;
  if (paid === 0n || received === 0n || Number(reached) === currentTick) {
    log(
      'taker',
      `${buying ? 'buy' : 'sell'} skipped: no fill current=${formatCentsForTick(
        currentTick,
      )} target=${formatCentsForTick(target)}`,
    );
    return;
  }

  const receipt = await taker.sendContract(market.book, bookAbi, 'sweepWithLimits', fnArgs);
  const afterTick = await readCurrentTick();
  if (buying) {
    log(
      'taker',
      `buy paid ${fromUnits(paid, market.quoteDecimals, 3)} ${market.quoteSymbol}, got ${fromUnits(
        received,
        market.baseDecimals,
        3,
      )} ${market.baseSymbol}; ${currentTick}->${afterTick} ${formatCentsForTick(afterTick)} tx=${
        receipt.transactionHash
      }`,
    );
  } else {
    log(
      'taker',
      `sell paid ${fromUnits(paid, market.baseDecimals, 3)} ${market.baseSymbol}, got ${fromUnits(
        received,
        market.quoteDecimals,
        3,
      )} ${market.quoteSymbol}; ${currentTick}->${afterTick} ${formatCentsForTick(afterTick)} tx=${
        receipt.transactionHash
      }`,
    );
  }
}

async function loop() {
  for (;;) {
    const status = await presenceStatus();
    if (!status.active) {
      if (Date.now() - idleLoggedAt > 30_000) {
        log('taker', idleMessage(status));
        idleLoggedAt = Date.now();
      }
      await sleep(IDLE_SLEEP_MS);
      continue;
    }

    try {
      await trade();
    } catch (e) {
      log('taker', `trade error: ${safeError(e)}`);
    }
    await sleep(randInt(LOOP_MIN_MS, LOOP_MAX_MS));
  }
}

loop().catch((e) => {
  log('taker', `fatal: ${safeError(e, 500)}`);
  process.exit(1);
});
