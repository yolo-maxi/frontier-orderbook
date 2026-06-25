// Presence-gated Frontier PM maker bot.
//
// The live market is a geometric YES/USDC book:
//   price = 1.0001 ** tick
// The bot keeps a random-walk fair value near the recentered current tick and
// owns both ask and bid ladders around that fair value. It sends no txs unless
// the heartbeat server reports a recent page view.
import { privateKeyToAccount } from 'viem/accounts';
import {
  ONE,
  bookAbi,
  clamp,
  deployment,
  ensureMintAndApproval,
  fairMaxTick,
  fairMinTick,
  formatCentsForTick,
  idleMessage,
  loadPrivateKey,
  log,
  makeWallet,
  market,
  maybeLoadPrivateKey,
  normalish,
  presenceStatus,
  pub,
  rand,
  randInt,
  readCurrentTick,
  safeError,
  seededMaxTick,
  seededMinTick,
  simulateContract,
  sleep,
  tickSpacing,
  tickToPrice,
  writeFairState,
} from './lib.mjs';

const owner = makeWallet(loadPrivateKey('MM_OWNER_PK', 'MM_OWNER_PK_FILE'));
const operatorPk = maybeLoadPrivateKey('MM_OPERATOR_PK', 'MM_OPERATOR_PK_FILE');
const operatorAddress = operatorPk ? privateKeyToAccount(operatorPk).address : null;

const LOOP_MIN_MS = Number(process.env.MM_LOOP_MIN_MS || 9_000);
const LOOP_MAX_MS = Number(process.env.MM_LOOP_MAX_MS || 15_000);
const IDLE_SLEEP_MS = Number(process.env.IDLE_SLEEP_MS || 5_000);
const QUOTE_WIDTH_MIN = Number(process.env.MM_WIDTH_MIN_TICKS || tickSpacing * 4);
const QUOTE_WIDTH_MAX = Number(process.env.MM_WIDTH_MAX_TICKS || tickSpacing * 8);
const QUOTE_SIZE_MIN = Number(process.env.MM_SIZE_MIN || 70);
const QUOTE_SIZE_MAX = Number(process.env.MM_SIZE_MAX || 180);
const INVENTORY_MINT = 500_000n * ONE;

let setupDone = false;
let askId = 0n;
let bidId = 0n;
let fairRaw = null;
let fairTick = null;
let fairVelocity = 0;
let centerTick = null;
let idleLoggedAt = 0;

function updateFair(currentTick) {
  if (fairRaw === null) {
    centerTick = Number(process.env.BOT_CENTER_TICK || currentTick);
    fairRaw = currentTick;
    fairTick = currentTick;
  }

  const centerPull = (centerTick - fairRaw) * 0.045;
  const currentPull = (currentTick - fairRaw) * 0.015;
  const shockScale = Math.random() < 0.14 ? 155 : 70;
  const shock = normalish() * shockScale;
  fairVelocity = clamp(fairVelocity * 0.68 + centerPull + currentPull + shock, -240, 240);
  fairRaw += fairVelocity;

  if (fairRaw < fairMinTick) {
    fairRaw = fairMinTick + rand(0, tickSpacing);
    fairVelocity = Math.abs(fairVelocity) * 0.35;
  } else if (fairRaw > fairMaxTick) {
    fairRaw = fairMaxTick - rand(0, tickSpacing);
    fairVelocity = -Math.abs(fairVelocity) * 0.35;
  }

  fairTick = clamp(Math.round(fairRaw / tickSpacing) * tickSpacing, fairMinTick, fairMaxTick);
  writeFairState({
    fairTick,
    fairPrice: tickToPrice(fairTick),
    centerTick,
    fairMinTick,
    fairMaxTick,
    seededMinTick,
    seededMaxTick,
    updatedAt: new Date().toISOString(),
  });
  return fairTick;
}

function quotePlan(currentTick) {
  const fair = updateFair(currentTick);
  const spread = tickSpacing * randInt(1, 3);
  const width = tickSpacing * randInt(
    Math.round(QUOTE_WIDTH_MIN / tickSpacing),
    Math.round(QUOTE_WIDTH_MAX / tickSpacing),
  );
  const liquidity = BigInt(randInt(QUOTE_SIZE_MIN, QUOTE_SIZE_MAX)) * ONE;

  let askLo = Math.ceil((fair + spread) / tickSpacing) * tickSpacing;
  askLo = Math.max(askLo, currentTick + tickSpacing, seededMinTick + tickSpacing);
  if (askLo + width > seededMaxTick) askLo = seededMaxTick - width;
  askLo = Math.ceil(askLo / tickSpacing) * tickSpacing;

  let bidHi = Math.floor((fair - spread) / tickSpacing) * tickSpacing;
  bidHi = Math.min(bidHi, currentTick, seededMaxTick - tickSpacing);
  if (bidHi - width < seededMinTick) bidHi = seededMinTick + width;
  bidHi = Math.floor(bidHi / tickSpacing) * tickSpacing;

  return {
    fair,
    spread,
    width,
    liquidity,
    ask: askLo > currentTick && askLo + width <= seededMaxTick ? { lower: askLo, upper: askLo + width } : null,
    bid: bidHi <= currentTick && bidHi - width >= seededMinTick ? { lower: bidHi - width, upper: bidHi } : null,
  };
}

async function ensureSetup() {
  if (setupDone) return;
  log('mm', 'activating owner', owner.address, 'operator', operatorAddress || '(single-key requotes)');
  log(
    'mm',
    `deployment book=${market.book} chain=${deployment.chainId} band=[${seededMinTick},${seededMaxTick}]`,
  );
  await ensureMintAndApproval(owner, market.base, market.book, INVENTORY_MINT);
  await ensureMintAndApproval(owner, market.quote, market.book, INVENTORY_MINT);
  setupDone = true;
  log('mm', `inventory minted/approved for ${market.baseSymbol}/${market.quoteSymbol}`);
}

async function cancelExisting() {
  if (askId) {
    try {
      const receipt = await owner.sendContract(market.book, bookAbi, 'cancel', [askId]);
      log('mm', `cancelled ask #${askId} tx=${receipt.transactionHash}`);
    } catch (e) {
      log('mm', `ask #${askId} cancel skipped: ${safeError(e, 90)}`);
    }
    askId = 0n;
  }
  if (bidId) {
    try {
      const receipt = await owner.sendContract(market.book, bookAbi, 'cancelBid', [bidId]);
      log('mm', `cancelled bid #${bidId} tx=${receipt.transactionHash}`);
    } catch (e) {
      log('mm', `bid #${bidId} cancel skipped: ${safeError(e, 90)}`);
    }
    bidId = 0n;
  }
}

async function depositPlan(plan, reason) {
  await cancelExisting();
  const liq = `${plan.liquidity / ONE}`;
  if (plan.ask) {
    try {
      const args = [plan.ask.lower, plan.ask.upper, plan.liquidity];
      const sim = await simulateContract(owner.account, market.book, bookAbi, 'deposit', args);
      askId = sim.result;
      const receipt = await owner.sendContract(market.book, bookAbi, 'deposit', args);
      log(
        'mm',
        `${reason} ask #${askId} ${formatCentsForTick(plan.ask.lower)}-${formatCentsForTick(
          plan.ask.upper,
        )} liq=${liq} tx=${receipt.transactionHash}`,
      );
    } catch (e) {
      askId = 0n;
      log(
        'mm',
        `${reason} ask failed lower=${plan.ask.lower} upper=${plan.ask.upper} liq=${liq}: ${safeError(e)}`,
      );
    }
  }
  if (plan.bid) {
    try {
      const args = [plan.bid.lower, plan.bid.upper, plan.liquidity];
      const sim = await simulateContract(owner.account, market.book, bookAbi, 'depositBid', args);
      bidId = sim.result;
      const receipt = await owner.sendContract(market.book, bookAbi, 'depositBid', args);
      log(
        'mm',
        `${reason} bid #${bidId} ${formatCentsForTick(plan.bid.lower)}-${formatCentsForTick(
          plan.bid.upper,
        )} liq=${liq} tx=${receipt.transactionHash}`,
      );
    } catch (e) {
      bidId = 0n;
      log(
        'mm',
        `${reason} bid failed lower=${plan.bid.lower} upper=${plan.bid.upper} liq=${liq}: ${safeError(e)}`,
      );
    }
  }
}

async function requotePlan(plan) {
  if (!askId || !bidId || !plan.ask || !plan.bid) {
    await depositPlan(plan, 'posted');
    return;
  }

  try {
    const askReceipt = await owner.sendContract(market.book, bookAbi, 'requote', [
      askId,
      plan.ask.lower,
      plan.ask.upper,
      plan.liquidity,
    ]);
    const bidReceipt = await owner.sendContract(market.book, bookAbi, 'requoteBid', [
      bidId,
      plan.bid.lower,
      plan.bid.upper,
      plan.liquidity,
    ]);
    log(
      'mm',
      `requoted fair=${formatCentsForTick(plan.fair)} ask=${formatCentsForTick(
        plan.ask.lower,
      )} bid=${formatCentsForTick(plan.bid.upper)} txs=${askReceipt.transactionHash},${bidReceipt.transactionHash}`,
    );
  } catch (e) {
    log('mm', `requote blocked, settling/reposting: ${safeError(e, 100)}`);
    await depositPlan(plan, 'reposted');
  }
}

async function step() {
  await ensureSetup();
  const currentTick = await readCurrentTick();
  const plan = quotePlan(currentTick);
  log(
    'mm',
    `current=${currentTick} ${formatCentsForTick(currentTick)} fair=${plan.fair} ${formatCentsForTick(
      plan.fair,
    )}`,
  );
  await requotePlan(plan);
}

async function loop() {
  for (;;) {
    const status = await presenceStatus();
    if (!status.active) {
      if (Date.now() - idleLoggedAt > 30_000) {
        log('mm', idleMessage(status));
        idleLoggedAt = Date.now();
      }
      await sleep(IDLE_SLEEP_MS);
      continue;
    }

    try {
      await step();
    } catch (e) {
      log('mm', `tick error: ${safeError(e)}`);
    }
    await sleep(randInt(LOOP_MIN_MS, LOOP_MAX_MS));
  }
}

loop().catch((e) => {
  log('mm', `fatal: ${safeError(e, 500)}`);
  process.exit(1);
});
