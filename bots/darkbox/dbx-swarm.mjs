#!/usr/bin/env node
// DarkBox prediction-market demo swarm.
//
// Funds ~N throwaway bot wallets from the deployer treasury (the authorized
// sUSDC minter), stands up a 2-sided geometric CLOB on the YES and NO books,
// then drives randomized taker flow (buy/sell YES/NO, split/merge) to produce
// a busy, Polymarket-like market with real on-chain activity.
//
// SAFE BY DEFAULT: dry-run unless --live; bounded duration; hard tx cap; never
// logs private keys. ARC testnet only.
//
//   node dbx-swarm.mjs                          # dry-run, 30s, 12 bots
//   node dbx-swarm.mjs --live --duration 60 --tps 3
//   node dbx-swarm.mjs --live --fund-only       # just fund + open the book
//
import {
  loadDeployment,
  loadEnvFile,
  makeChain,
  makePublic,
  makeBot,
  deriveBotKeys,
  chainDeadline,
  bookAbi,
  erc20Abi,
  routerAbi,
  lensAbi,
  marketAbi,
  tickToPrice,
  probToTick,
  fmt6,
  sleep,
  rint,
  pick,
  log,
  safe,
} from "./dbx-lib.mjs";
import { encodeFunctionData } from "viem";

// ── args ──────────────────────────────────────────────────────────────--
const argv = process.argv.slice(2);
const flag = (n, d) => {
  const i = argv.indexOf(`--${n}`);
  if (i < 0) return d;
  const v = argv[i + 1];
  return v && !v.startsWith("--") ? v : true;
};
const cfg = {
  live: argv.includes("--live"),
  bots: Number(flag("bots", 12)),
  tps: Number(flag("tps", 2)),
  duration: Number(flag("duration", 30)),
  fair: Number(flag("fair", 0.3)),
  fundUsdc: Number(flag("fund-usdc", 2000)),
  gasEth: Number(flag("gas-eth", 0.05)),
  seed: String(flag("seed", process.env.DBX_BOT_SEED || "darkbox-arc-demo-swarm-v1")),
  envPath: String(flag("env", "/home/xiko/darkbox/.secrets/arc-testnet-submission.env")),
  rpc: flag("rpc", null),
  fundOnly: argv.includes("--fund-only"),
  noMm: argv.includes("--no-mm"),
  maxTx: Number(flag("max-tx", 0)) || 0,
};

// ── wiring ────────────────────────────────────────────────────────────--
const dep = loadDeployment();
const env = loadEnvFile(cfg.envPath);
const rpcUrl = cfg.rpc || env.ARC_RPC_URL || dep.rpcUrl;
const chain = makeChain(dep, rpcUrl);
const pub = makePublic(chain, rpcUrl);

const A = {
  router: dep.contracts.router,
  lens: dep.contracts.lens,
  usdc: dep.contracts.usdc,
  market: dep.darkbox.market.market,
  yesBook: dep.darkbox.market.yesBook,
  noBook: dep.darkbox.market.noBook,
  yesToken: dep.darkbox.market.yesToken,
  noToken: dep.darkbox.market.noToken,
};
const BOOKS = {
  YES: { book: A.yesBook, token: A.yesToken },
  NO: { book: A.noBook, token: A.noToken },
};

// Each leg discovers its OWN price (independent maker fair + taker flow) — the two
// are NOT hard-coupled: there is a real spread and they move independently. An
// arbitrage strategy keeps YES + NO ≈ 100¢ the way real prediction markets do:
// when the pair is cheap (<100¢) an arber buys both and MERGES; when rich (>100¢)
// it SPLITS and sells both. Deviations only persist inside a small no-arb band.
let yesFair = cfg.fair;
let noFair = 1 - cfg.fair;
let yesFlow = 0;
let noFlow = 0;
const ARB_BAND = 0.015; // ~1.5¢ no-arb tolerance before arbitrage corrects
const FLOW_SENS = 0.006; // net sUSDC of flow -> probability nudge per cycle (gentle: flow is
//                          balanced now, so this just adds small momentum, not a runaway trend)
const clampP = (p) => Math.max(0.05, Math.min(0.95, p));
const clampD = (d) => Math.max(-0.03, Math.min(0.03, d));
const addFlow = (side, x) => (side === "YES" ? (yesFlow += x) : (noFlow += x));

if (!cfg.maxTx) cfg.maxTx = Math.ceil(cfg.tps * cfg.duration * 1.5) + cfg.bots * 12 + 64;

// ── metrics ───────────────────────────────────────────────────────────--
const M = {
  start: 0,
  attempts: 0,
  ok: 0,
  fail: 0,
  byType: {},
  inflight: 0,
  txBudget: cfg.maxTx,
};
const bump = (type, ok) => {
  M.byType[type] = M.byType[type] || { ok: 0, fail: 0 };
  if (ok) {
    M.ok++;
    M.byType[type].ok++;
  } else {
    M.fail++;
    M.byType[type].fail++;
  }
};

// ── treasury + bots ───────────────────────────────────────────────────--
const treasuryPk = env.DEPLOYER_KEY;
if (cfg.live && !treasuryPk) {
  console.error(
    `\n  --live needs a funded treasury key. Set DEPLOYER_KEY in ${cfg.envPath} ` +
      `(the authorized sUSDC minter). Aborting before any tx.\n`,
  );
  process.exit(1);
}
const treasury = cfg.live ? makeBot(treasuryPk, chain, rpcUrl, pub) : null;
const botKeys = deriveBotKeys(cfg.bots, cfg.seed);
const bots = botKeys.map((k) => makeBot(k, chain, rpcUrl, pub));
const mmYes = bots[0];
const mmNo = bots[Math.min(1, bots.length - 1)];
const takers = bots.length > 2 ? bots.slice(2) : bots;

function banner() {
  log("cfg", safe(`mode=${cfg.live ? "LIVE" : "DRY-RUN"} bots=${cfg.bots} tps=${cfg.tps} duration=${cfg.duration}s`));
  log("cfg", `rpc=${rpcUrl} chain=${dep.chainId}`);
  log("cfg", `market=${A.market}`);
  log("cfg", `yesBook=${A.yesBook} noBook=${A.noBook}`);
  log("cfg", `fair(YES)=${cfg.fair} maxTx=${cfg.maxTx}`);
  if (cfg.live) log("cfg", `treasury=${treasury.addr} (sUSDC minter)`);
  log("cfg", `bots[0..${bots.length - 1}] e.g. ${bots[0].addr}, ${bots[bots.length - 1].addr}`);
}

// ── funding + approvals (live) ────────────────────────────────────────--
const MAXU = 2n ** 255n;
async function ensureFunded(bot, sUsdcTarget, gasEth = cfg.gasEth) {
  const [gas, bal] = await Promise.all([
    pub.getBalance({ address: bot.addr }),
    pub.readContract({ address: A.usdc, abi: erc20Abi, functionName: "balanceOf", args: [bot.addr] }),
  ]);
  const gasNeed = BigInt(Math.floor(gasEth * 1e18));
  if (gas < (gasNeed * 2n) / 3n) {
    await treasury.sendValue(bot.addr, gasNeed);
    M.attempts++;
  }
  if (bal < BigInt(Math.floor(sUsdcTarget * 1e6)) / 2n) {
    await treasury.send(A.usdc, erc20Abi, "mint", [bot.addr, BigInt(Math.floor(sUsdcTarget * 1e6))]);
    M.attempts++;
  }
}

async function ensureApproval(bot, token, spender) {
  const a = await pub.readContract({ address: token, abi: erc20Abi, functionName: "allowance", args: [bot.addr, spender] });
  if (a < MAXU / 2n) {
    await bot.send(token, erc20Abi, "approve", [spender, MAXU]);
    M.attempts++;
  }
}

async function setupBot(bot, isMm) {
  // MM bots pay a one-time ~2.2M-gas moveTickTo to drag the frontier from the
  // construction tick (200000) into the probability band, so give them more gas.
  await ensureFunded(bot, cfg.fundUsdc, isMm ? Math.max(cfg.gasEth, 0.3) : cfg.gasEth);
  await ensureApproval(bot, A.usdc, A.market); // split/merge
  await ensureApproval(bot, A.usdc, A.router); // arb buys
  // Every bot now trades directly on the books via BOUNDED sweepWithLimits (the
  // router's fixed 200000-tick SWEEP_WINDOW could otherwise punch the frontier
  // out of band on a thin book), so all bots need book approvals on both sides.
  await ensureApproval(bot, A.usdc, A.yesBook);
  await ensureApproval(bot, A.usdc, A.noBook);
  await ensureApproval(bot, A.yesToken, A.yesBook);
  await ensureApproval(bot, A.noToken, A.noBook);
  await ensureApproval(bot, A.yesToken, A.router);
  await ensureApproval(bot, A.noToken, A.router);
  // give every bot YES/NO inventory so sells work immediately
  await splitInventory(bot, isMm ? 1400 : 250, true);
}

async function splitInventory(bot, usdc, skipIfStocked = false) {
  const amt = BigInt(Math.floor(usdc * 1e6));
  if (skipIfStocked) {
    const yes = await pub.readContract({ address: A.yesToken, abi: erc20Abi, functionName: "balanceOf", args: [bot.addr] });
    if (yes >= amt) return; // already holds inventory from a prior run
  }
  const bal = await pub.readContract({ address: A.usdc, abi: erc20Abi, functionName: "balanceOf", args: [bot.addr] });
  if (bal < amt) return;
  try {
    await bot.send(A.market, marketAbi, "split", [amt, bot.addr]);
    bump("split", true);
    M.attempts++;
  } catch (e) {
    bump("split", false);
    log("split", safe(e.shortMessage || e.message || "fail").slice(0, 90));
  }
}

// ── market making: open + maintain a 2-sided book straddling fair ─────---
const LADDER = 320; // ticks of depth per order (~3.2¢ — wide enough to show a profile)
const OFFSET = 40; // ticks frontier→inside quote (~0.4¢) so the bid/ask spread stays <1¢ and the
                   // two clusters sit close; bounded sweeps keep the frontier from blowing out, so
                   // the big race buffer that forced 140 is no longer needed
const MM_SIZE = 2000000n; // token0 per level — thick book so heavy taker flow can't drain a side
//                           between the (3s) maker refreshes
const rsize = () => (MM_SIZE * BigInt(65 + Math.floor(Math.random() * 70))) / 100n; // 0.65×–1.35×
const mmState = { YES: { askId: 0n, bidId: 0n }, NO: { askId: 0n, bidId: 0n } };

/** Cancel this maker's own resting positions left over from earlier runs, so the
 * frontier peg (moveTickTo) never has to cross stale liquidity. */
async function reclaim(bot, book) {
  const latest = await pub.getBlockNumber().catch(() => 0n);
  if (!latest) return;
  const span = 240000n;
  const win = 45000n;
  const start = latest > span ? latest - span : 0n;
  const logs = [];
  for (let f = start; f <= latest; f += win + 1n) {
    const t = f + win > latest ? latest : f + win;
    try {
      logs.push(
        ...(await pub.getContractEvents({
          address: book,
          abi: bookAbi,
          eventName: "Deposit",
          args: { owner: bot.addr },
          fromBlock: f,
          toBlock: t,
        })),
      );
    } catch {
      /* skip window */
    }
  }
  const ids = [...new Set(logs.map((l) => l.args.positionId))];
  let n = 0;
  for (const id of ids) {
    try {
      const p = await pub.readContract({ address: book, abi: bookAbi, functionName: "positions", args: [id] });
      if (!p[7]) continue; // not live
      const isBid = p[8];
      const lower = p[1]; // exact tick → correct witness if plain cancel reverts
      try {
        await bot.send(book, bookAbi, isBid ? "cancelBid" : "cancel", [id]);
      } catch {
        await bot.send(book, bookAbi, isBid ? "cancelBidWithWitness" : "cancelWithWitness", [id, lower]);
      }
      M.attempts++;
      n++;
    } catch {
      /* already consumed / unrecoverable — band-gating hides it anyway */
    }
  }
  if (n) log("mm", `reclaimed ${n} stale position(s) on ${book.slice(0, 10)}…`);
}

async function isLive(book, id) {
  if (!id) return false;
  try {
    const p = await pub.readContract({ address: book, abi: bookAbi, functionName: "positions", args: [id] });
    return p[7];
  } catch {
    return false;
  }
}

async function recenter(bot, side, prob) {
  const { book } = BOOKS[side];
  const target = probToTick(prob);
  const st = mmState[side];
  const askBase = rsize();
  const bidBase = rsize();
  // Restock FIRST, before pegging. Asks SELL token0, so when inventory runs low the
  // maker re-splits sUSDC into a fresh YES+NO set. Doing that split AFTER pegging put
  // a ~1.5s tx right in the critical window between the peg and the ask deposit —
  // long enough for taker buy-flow to push the frontier past askLo and revert the
  // deposit, leaving the buy side empty. Out of the critical path it goes.
  try {
    const have = await pub.readContract({ address: BOOKS[side].token, abi: erc20Abi, functionName: "balanceOf", args: [bot.addr] });
    if (have < askBase * BigInt(LADDER) * 2n) await splitInventory(bot, 1000);
  } catch {
    /* best-effort restock */
  }
  // settle prior quotes — each cancel is an independent tx, so a cancel that
  // reverts (the position was already consumed by a taker) doesn't block the rest.
  for (const [k, fn, wfn] of [
    ["askId", "cancel", "cancelWithWitness"],
    ["bidId", "cancelBid", "cancelBidWithWitness"],
  ]) {
    if (st[k]) {
      try {
        await bot.send(book, bookAbi, fn, [st[k]]);
      } catch {
        // plain cancel reverts once a quote has been PARTIALLY filled. If left
        // resting, those touched remnants pile up cycle after cycle into a lopsided
        // wall (the bids did this while eaten asks vanished). Clear by witness.
        try {
          const p = await pub.readContract({ address: book, abi: bookAbi, functionName: "positions", args: [st[k]] });
          if (p[7]) await bot.send(book, bookAbi, wfn, [st[k], p[1]]);
        } catch {
          /* already fully consumed — nothing to clear */
        }
      }
      st[k] = 0n;
    }
  }
  // Peg the frontier to target. Bounded taker sweeps (±SWEEP_CAP) mean that even
  // if a taker trades during this brief window, the frontier can't blow out of
  // band — so the recenter doesn't need to be atomic.
  let cur = Number(await pub.readContract({ address: book, abi: bookAbi, functionName: "currentTick" }));
  if (Math.abs(cur - target) > 2) {
    try {
      await bot.send(book, bookAbi, "moveTickTo", [target]);
      M.attempts++;
      cur = target;
    } catch (e) {
      log("mm", side, "moveTickTo fail", safe(e.shortMessage || e.message || "").slice(0, 60));
    }
  }
  // Re-read the frontier right before posting, with no tx in between. askLo/bidHi
  // then get the FULL OFFSET buffer measured from the freshest tick (post-peg taker
  // drift included), so a small OFFSET still survives to the deposit's mine time.
  cur = Number(await pub.readContract({ address: book, abi: bookAbi, functionName: "currentTick" }));
  // Never post at an out-of-band frontier. If moveTickTo failed and cur is still
  // ≥ 0 (price ≥ 1), posting an ask here drops an orphan near tick 200000 that
  // then blocks the NEXT moveTickTo (it crosses a resting ask → revert) — the
  // cascade that strands the book. Skip this cycle; a later moveTickTo recovers it.
  if (cur >= 0) {
    log("mm", side, `frontier OOB (tick ${cur}) — skip post`);
    return;
  }
  const askLo = cur + OFFSET;
  const bidHi = cur - OFFSET;
  try {
    const sim = await pub.simulateContract({ address: book, abi: bookAbi, functionName: "deposit", args: [askLo, askLo + LADDER, askBase], account: bot.account });
    st.askId = sim.result;
    await bot.send(book, bookAbi, "deposit", [askLo, askLo + LADDER, askBase]);
    bump("mm-ask", true);
  } catch (e) {
    bump("mm-ask", false);
    log("mm", side, "ask fail", safe(e.shortMessage || e.message || "").slice(0, 60));
  }
  try {
    const sim = await pub.simulateContract({ address: book, abi: bookAbi, functionName: "depositBid", args: [bidHi - LADDER, bidHi, bidBase], account: bot.account });
    st.bidId = sim.result;
    await bot.send(book, bookAbi, "depositBid", [bidHi - LADDER, bidHi, bidBase]);
    bump("mm-bid", true);
  } catch (e) {
    bump("mm-bid", false);
    log("mm", side, "bid fail", safe(e.shortMessage || e.message || "").slice(0, 60));
  }
  M.attempts += 2;
  log("mm", `${side} ${(tickToPrice(cur) * 100).toFixed(1)}¢ pegged ask@${(tickToPrice(askLo) * 100).toFixed(1)}¢ bid@${(tickToPrice(bidHi) * 100).toFixed(1)}¢`);
}

// ── taker actions ─────────────────────────────────────────────────────--
const SWEEP_CAP = 400; // max ticks (~4¢) a single taker trade can move the frontier

async function takerTrade(bot) {
  // bias hard toward the reliable YES book (NO book is flaky) so visible activity
  // and chart movement concentrate where they render
  const side = Math.random() < 0.85 ? "YES" : "NO";
  const { book, token } = BOOKS[side];
  const buy = Math.random() < 0.5;
  const dl = await chainDeadline(pub, 300);
  const cur = Number(await pub.readContract({ address: book, abi: bookAbi, functionName: "currentTick" }));
  if (buy) {
    const amt1 = BigInt(rint(120000, 600000)); // 0.12–0.6 sUSDC — small enough that one buy
    //   can't clear the best ask between requotes, so the touch stays populated (no gap)
    const type = `buy-${side}`;
    if (!cfg.live) return dryQuote(book, "quoteBuy", [book, amt1], type);
    addFlow(side, Number(amt1) / 1e6); // buying pressures this leg up
    try {
      // BOUNDED up-sweep on the book — can't move the frontier > SWEEP_CAP ticks,
      // so a buy on a thin book can never blow the price out of band.
      await bot.send(book, bookAbi, "sweepWithLimits", [cur + SWEEP_CAP, 64n, amt1, 0n, dl]);
      bump(type, true);
    } catch {
      bump(type, false);
    }
  } else {
    const shares = BigInt(rint(120000, 600000)); // 0.12–0.6 shares — keep the bid touch populated too
    const type = `sell-${side}`;
    let bal = await pub.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [bot.addr] });
    if (bal < shares) {
      // restock then SELL. Returning here (the old behaviour) meant a sell silently
      // skipped whenever inventory was short — so over the run sells fired far less
      // often than buys, net flow was buy-biased, and fair marched up the rails.
      // Split, re-read, and go through with the sell so buy/sell flow stays balanced.
      if (!cfg.live) return;
      await splitInventory(bot, 50);
      bal = await pub.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [bot.addr] });
      if (bal < shares) return; // still short (split failed) — skip just this one
    }
    if (!cfg.live) return dryQuote(book, "quoteSell", [book, shares, 256n], type);
    addFlow(side, -Number(shares) / 1e6); // selling pressures this leg down
    try {
      await bot.send(book, bookAbi, "sweepWithLimits", [cur - SWEEP_CAP, 64n, shares, 0n, dl]);
      bump(type, true);
    } catch {
      bump(type, false);
    }
  }
}

// real arbitrage: when the complement is mispriced, an arber buys both legs and
// merges (pair < 100¢) or splits and sells both legs (pair > 100¢) — visible
// on-chain activity that pulls YES + NO back toward 100¢.
async function boundedSweep(bot, book, dir, budget, dl) {
  const cur = Number(await pub.readContract({ address: book, abi: bookAbi, functionName: "currentTick" }));
  const target = dir === "up" ? cur + SWEEP_CAP : cur - SWEEP_CAP;
  return bot.send(book, bookAbi, "sweepWithLimits", [target, 64n, budget, 0n, dl]);
}

async function fireArb(kind) {
  const bot = pick(takers);
  const dl = await chainDeadline(pub, 300);
  M.attempts += 3;
  if (kind === "cheap") {
    const amt1 = BigInt(rint(2, 6)) * 1_000_000n;
    try {
      // buy both legs (bounded) then merge the set back to sUSDC
      await boundedSweep(bot, A.yesBook, "up", amt1, dl);
      await boundedSweep(bot, A.noBook, "up", amt1, dl);
      const [y, n] = await Promise.all([
        pub.readContract({ address: A.yesToken, abi: erc20Abi, functionName: "balanceOf", args: [bot.addr] }),
        pub.readContract({ address: A.noToken, abi: erc20Abi, functionName: "balanceOf", args: [bot.addr] }),
      ]);
      const m = y < n ? y : n;
      if (m > 0n) await bot.send(A.market, marketAbi, "merge", [m, bot.addr]);
      bump("arb-merge", true);
    } catch {
      bump("arb-merge", false);
    }
  } else {
    const amt = BigInt(rint(2, 6)) * 1_000_000n;
    try {
      // split a set then sell both legs (bounded) into the rich bids
      await bot.send(A.market, marketAbi, "split", [amt, bot.addr]);
      await boundedSweep(bot, A.yesBook, "down", amt, dl);
      await boundedSweep(bot, A.noBook, "down", amt, dl);
      bump("arb-sell", true);
    } catch {
      bump("arb-sell", false);
    }
  }
}

async function dryQuote(book, fn, args, type) {
  try {
    const r = await pub.readContract({ address: A.lens, abi: lensAbi, functionName: fn, args });
    bump(type, true);
    if (M.attempts % 7 === 0) log("dry", `${type} -> out=${fmt6(r[0]).toFixed(3)} endTick=${r[2]}`);
  } catch {
    bump(type, false);
  }
}

async function takerSplitMerge(bot) {
  if (Math.random() < 0.5) {
    if (cfg.live) await splitInventory(bot, rint(50, 200));
    else bump("split", true);
  } else {
    const [y, n] = await Promise.all([
      pub.readContract({ address: A.yesToken, abi: erc20Abi, functionName: "balanceOf", args: [bot.addr] }),
      pub.readContract({ address: A.noToken, abi: erc20Abi, functionName: "balanceOf", args: [bot.addr] }),
    ]);
    const m = y < n ? y : n;
    if (m < 1000000n) return;
    const amt = m / 2n;
    if (!cfg.live) return bump("merge", true);
    try {
      await bot.send(A.market, marketAbi, "merge", [amt, bot.addr]);
      bump("merge", true);
      M.attempts++;
    } catch {
      bump("merge", false);
    }
  }
}

// ── scheduler ─────────────────────────────────────────────────────────--
let stopping = false;
function fireOne() {
  if (stopping || M.attempts >= M.txBudget) return;
  if (M.inflight > cfg.bots * 2) return; // backpressure: don't outrun confirmation
  const bot = pick(takers);
  M.attempts++;
  M.inflight++;
  const action = Math.random() < 0.1 ? takerSplitMerge(bot) : takerTrade(bot);
  action.catch(() => {}).finally(() => {
    M.inflight--;
  });
}

function report(final = false) {
  const el = (Date.now() - M.start) / 1000;
  const tps = (M.ok / Math.max(0.001, el)).toFixed(2);
  const types = Object.entries(M.byType)
    .map(([k, v]) => `${k} ${v.ok}/${v.ok + v.fail}`)
    .join("  ");
  log(final ? "DONE" : "stat", `t=${el.toFixed(0)}s ok=${M.ok} fail=${M.fail} inflight=${M.inflight} tps≈${tps}`);
  if (types) log(final ? "DONE" : "stat", types);
}

async function main() {
  banner();
  // connectivity check
  const bn = await pub.getBlockNumber().catch((e) => {
    console.error("RPC unreachable:", safe(e.message));
    process.exit(1);
  });
  log("net", `connected, block ${bn}`);

  M.start = Date.now();

  if (cfg.live) {
    log("setup", `funding ${bots.length} bots + approvals…`);
    // MM bots first (serial), then takers in small parallel batches
    await setupBot(mmYes, true);
    if (mmNo !== mmYes) await setupBot(mmNo, true);
    const batch = 4;
    for (let i = 0; i < takers.length; i += batch) {
      await Promise.all(takers.slice(i, i + batch).map((b) => setupBot(b, false).catch((e) => log("setup", safe(e.message).slice(0, 80)))));
    }
    log("setup", "funded. opening books…");
    if (!cfg.noMm) {
      await reclaim(mmYes, A.yesBook);
      await reclaim(mmNo, A.noBook);
      await recenter(mmYes, "YES", yesFair);
      await recenter(mmNo, "NO", noFair);
      // moveTickTo can revert transiently under load — retry each open until the
      // frontier is actually in band, so trading never starts on a stuck book.
      for (const [bot, side, prob, bk] of [
        [mmYes, "YES", yesFair, A.yesBook],
        [mmNo, "NO", noFair, A.noBook],
      ]) {
        for (let a = 0; a < 6; a++) {
          const ct = Number(await pub.readContract({ address: bk, abi: bookAbi, functionName: "currentTick" }));
          if (ct < 0) break; // in band → open
          log("setup", `${side} not open yet (tick ${ct}) — retry ${a + 1}`);
          await sleep(1500);
          await recenter(bot, side, prob);
        }
      }
    }
    report();
    if (cfg.fundOnly) {
      log("DONE", "fund-only complete — books opened, no trading loop.");
      report(true);
      return;
    }
  } else {
    log("dry", "no transactions will be sent. Simulating taker quotes against live books.");
  }

  // trading loop
  const interval = Math.max(40, Math.floor(1000 / cfg.tps));
  const sched = setInterval(fireOne, interval);
  const statTimer = setInterval(() => report(false), 5000);
  // periodic gas/sUSDC top-up — a long high-volume run drains bot wallets, and once
  // a maker is out of gas its posts fail with "insufficient balance" and its side of
  // the book goes empty (one-sided). ensureFunded only sends when actually low, so
  // this is idempotent. Refill from treasury every 25s.
  let funding = false;
  const fundTimer = cfg.live
    ? setInterval(async () => {
        if (stopping || funding) return;
        funding = true;
        try {
          for (const b of bots) await ensureFunded(b, cfg.fundUsdc, Math.max(cfg.gasEth, 0.35));
        } catch (e) {
          log("fund", safe(e.message || "").slice(0, 60));
        } finally {
          funding = false;
        }
      }, 25000)
    : null;
  // MM recenter loop (live) — keeps books fresh + nudges the price by fair drift
  let mmTimer = null;
  let mmBusy = false;
  if (cfg.live && !cfg.noMm) {
    mmTimer = setInterval(async () => {
      if (stopping || mmBusy) return; // skip a tick if the prior cycle is still settling
      mmBusy = true;
      // each leg drifts on its OWN flow + noise — independent price discovery, with
      // occasional "news" swings so the chart stays varied. Kept modest (±8¢, was
      // ±16¢) so fair doesn't lurch far from the resting quotes and strand them
      // off-centre — that stranding is part of what spread the clusters apart.
      // Fair must move GENTLY: at 1.5s cycles, big per-cycle steps make the maker
      // chase a new price every cycle and post quotes all over the book, which then
      // strand into a wide smear (the "gap"). Keep each step small and news jumps
      // under the ladder width (~3.2¢) so consecutive quotes overlap into ONE tight
      // cluster. Mean-revert toward 0.5 so it still can't wander to an extreme.
      const newsY = Math.random() < 0.08 ? (Math.random() - 0.5) * 0.04 : 0; // ≤±2¢, rare
      const newsN = Math.random() < 0.08 ? (Math.random() - 0.5) * 0.04 : 0;
      const revert = (f) => 0.5 + (f - 0.5) * 0.97;
      yesFair = clampP(revert(yesFair) + clampD(yesFlow * FLOW_SENS) + (Math.random() - 0.5) * 0.008 + newsY);
      noFair = clampP(revert(noFair) + clampD(noFlow * FLOW_SENS) + (Math.random() - 0.5) * 0.008 + newsN);
      yesFlow *= 0.4;
      noFlow *= 0.4;
      // arbitrage pulls the complement back toward 100¢ only when it leaves the band
      const sum = yesFair + noFair;
      if (Math.abs(sum - 1) > ARB_BAND) {
        const corr = (sum - 1) / 2;
        yesFair = clampP(yesFair - corr);
        noFair = clampP(noFair - corr);
        fireArb(sum > 1 ? "rich" : "cheap").catch(() => {});
      }
      try {
        // YES and NO are independent wallets → requote both concurrently so the
        // near-touch quotes are refreshed sooner and buys can't open as wide a gap.
        await Promise.all([recenter(mmYes, "YES", yesFair), recenter(mmNo, "NO", noFair)]);
        log("mm", `YES ${(yesFair * 100).toFixed(1)}¢  NO ${(noFair * 100).toFixed(1)}¢  sum ${((yesFair + noFair) * 100).toFixed(1)}¢`);
      } catch (e) {
        log("mm", "recenter cycle error", safe(e.message).slice(0, 70));
      } finally {
        mmBusy = false; // re-arm for the next cycle
      }
    }, 1500);
  }

  await sleep(cfg.duration * 1000);
  stopping = true;
  clearInterval(sched);
  clearInterval(statTimer);
  if (fundTimer) clearInterval(fundTimer);
  if (mmTimer) clearInterval(mmTimer);
  log("stop", "duration reached — draining in-flight…");
  for (let i = 0; i < 30 && M.inflight > 0; i++) await sleep(500);
  // settle: leave both books on a clean two-sided quote so the final on-chain
  // state is tight and complementary (YES + NO ≈ 100¢), not a half-finished cycle.
  if (cfg.live && !cfg.noMm) {
    log("stop", "settling books to a clean complementary quote…");
    for (const [bot, side, prob] of [
      [mmYes, "YES", yesFair],
      [mmNo, "NO", noFair],
    ]) {
      for (let a = 0; a < 2; a++) {
        try {
          await recenter(bot, side, prob);
          break;
        } catch (e) {
          log("stop", `settle ${side} retry`, safe(e.message).slice(0, 50));
        }
      }
    }
    log("stop", `final: YES ${(yesFair * 100).toFixed(1)}¢  NO ${(noFair * 100).toFixed(1)}¢  sum ${((yesFair + noFair) * 100).toFixed(1)}¢`);
  }
  report(true);
}

let sigint = false;
process.on("SIGINT", () => {
  if (sigint) process.exit(1);
  sigint = true;
  stopping = true;
  log("stop", "SIGINT — draining…");
  setTimeout(() => {
    report(true);
    process.exit(0);
  }, 2500);
});

main().then(
  () => setTimeout(() => process.exit(0), 500),
  (e) => {
    console.error("fatal:", safe(e.stack || e.message));
    process.exit(1);
  },
);
