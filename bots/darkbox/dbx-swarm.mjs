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
const FLOW_SENS = 0.02; // net sUSDC of flow -> probability nudge per cycle
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
  // takers buy/sell via router and split via market
  await ensureApproval(bot, A.usdc, A.router);
  await ensureApproval(bot, A.usdc, A.market);
  await ensureApproval(bot, A.yesToken, A.router);
  await ensureApproval(bot, A.noToken, A.router);
  // give every bot a little YES/NO inventory so sells work immediately
  await splitInventory(bot, 200, true);
  if (isMm) {
    // makers also rest liquidity directly on the books
    await ensureApproval(bot, A.usdc, A.yesBook);
    await ensureApproval(bot, A.usdc, A.noBook);
    await ensureApproval(bot, A.yesToken, A.yesBook);
    await ensureApproval(bot, A.noToken, A.noBook);
    await splitInventory(bot, 600, true);
  }
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
const LADDER = 150; // ticks of depth per order (~1.5¢)
const OFFSET = 8; // ticks between frontier and the inside quote
const MM_SIZE = 250000n; // token0 per level (≈0.25 share/level → ~37 shares/order)
const mmState = { YES: { askId: 0n, bidId: 0n }, NO: { askId: 0n, bidId: 0n } };

/** Cancel this maker's own resting positions left over from earlier runs, so the
 * frontier peg (moveTickTo) never has to cross stale liquidity. */
async function reclaim(bot, book) {
  let logs = [];
  try {
    const latest = await pub.getBlockNumber();
    const from = latest > 60000n ? latest - 60000n : 0n;
    logs = await pub.getContractEvents({
      address: book,
      abi: bookAbi,
      eventName: "Deposit",
      args: { owner: bot.addr },
      fromBlock: from,
      toBlock: latest,
    });
  } catch {
    return;
  }
  const ids = [...new Set(logs.map((l) => l.args.positionId))];
  let n = 0;
  for (const id of ids) {
    try {
      const p = await pub.readContract({ address: book, abi: bookAbi, functionName: "positions", args: [id] });
      if (!p[7]) continue; // not live
      await bot.send(book, bookAbi, p[8] ? "cancelBid" : "cancel", [id]);
      M.attempts++;
      n++;
    } catch {
      /* already consumed / raced */
    }
  }
  if (n) log("mm", `reclaimed ${n} stale position(s) on ${book.slice(0, 10)}…`);
}

async function recenter(bot, side, prob) {
  const { book } = BOOKS[side];
  const target = probToTick(prob);
  const st = mmState[side];
  // settle prior quotes (filled or stale)
  for (const [k, fn] of [["askId", "cancel"], ["bidId", "cancelBid"]]) {
    if (st[k]) {
      try {
        await bot.send(book, bookAbi, fn, [st[k]]);
      } catch {
        /* already consumed */
      }
      st[k] = 0n;
    }
  }
  // Peg the frontier to target so the displayed price tracks `fair` and the two
  // outcome books stay complementary (YES + NO ≈ 100¢, the no-arb identity). Our
  // own orders were just cancelled and takers never rest liquidity, so moveTickTo
  // crosses nothing; orphans from earlier runs are cleared by reclaim() at setup.
  let cur = Number(await pub.readContract({ address: book, abi: bookAbi, functionName: "currentTick" }));
  if (Math.abs(cur - target) > 2) {
    try {
      await bot.send(book, bookAbi, "moveTickTo", [target]);
      M.attempts++;
      cur = target;
    } catch (e) {
      log("mm", side, "moveTickTo fail", safe(e.shortMessage || e.message || "").slice(0, 70));
      cur = Number(await pub.readContract({ address: book, abi: bookAbi, functionName: "currentTick" }));
    }
  }
  const askLo = cur + OFFSET;
  const bidHi = cur - OFFSET;
  try {
    const sim = await pub.simulateContract({ address: book, abi: bookAbi, functionName: "deposit", args: [askLo, askLo + LADDER, MM_SIZE], account: bot.account });
    st.askId = sim.result;
    await bot.send(book, bookAbi, "deposit", [askLo, askLo + LADDER, MM_SIZE]);
    bump("mm-ask", true);
  } catch (e) {
    bump("mm-ask", false);
    log("mm", side, "ask fail", safe(e.shortMessage || e.message || "").slice(0, 70));
  }
  try {
    const sim = await pub.simulateContract({ address: book, abi: bookAbi, functionName: "depositBid", args: [bidHi - LADDER, bidHi, MM_SIZE], account: bot.account });
    st.bidId = sim.result;
    await bot.send(book, bookAbi, "depositBid", [bidHi - LADDER, bidHi, MM_SIZE]);
    bump("mm-bid", true);
  } catch (e) {
    bump("mm-bid", false);
    log("mm", side, "bid fail", safe(e.shortMessage || e.message || "").slice(0, 70));
  }
  M.attempts += 2;
  log("mm", `${side} centered ~${(tickToPrice(cur) * 100).toFixed(1)}¢ ask@${(tickToPrice(askLo) * 100).toFixed(1)}¢ bid@${(tickToPrice(bidHi) * 100).toFixed(1)}¢`);
}

// ── taker actions ─────────────────────────────────────────────────────--
async function takerTrade(bot) {
  const side = Math.random() < 0.5 ? "YES" : "NO";
  const { book, token } = BOOKS[side];
  const buy = Math.random() < 0.5;
  const dl = await chainDeadline(pub, 300);
  if (buy) {
    const amt1 = BigInt(rint(500000, 6000000)); // 0.5–6 sUSDC
    const type = `buy-${side}`;
    if (!cfg.live) return dryQuote(book, "quoteBuy", [book, amt1], type);
    addFlow(side, Number(amt1) / 1e6); // buying pressures this leg up
    try {
      await bot.send(A.router, routerAbi, "buyExactIn", [book, amt1, 0n, bot.addr, dl]);
      bump(type, true);
    } catch (e) {
      bump(type, false);
    }
  } else {
    const shares = BigInt(rint(500000, 5000000)); // 0.5–5 shares
    const type = `sell-${side}`;
    const bal = await pub.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [bot.addr] });
    if (bal < shares) {
      if (cfg.live) await splitInventory(bot, 100);
      return;
    }
    if (!cfg.live) return dryQuote(book, "quoteSell", [book, shares, 256n], type);
    addFlow(side, -Number(shares) / 1e6); // selling pressures this leg down
    try {
      await bot.send(A.router, routerAbi, "sellExactIn", [book, shares, 0n, bot.addr, dl]);
      bump(type, true);
    } catch (e) {
      bump(type, false);
    }
  }
}

// real arbitrage: when the complement is mispriced, an arber buys both legs and
// merges (pair < 100¢) or splits and sells both legs (pair > 100¢) — visible
// on-chain activity that pulls YES + NO back toward 100¢.
async function fireArb(kind) {
  const bot = pick(takers);
  const dl = await chainDeadline(pub, 300);
  M.attempts += 3;
  if (kind === "cheap") {
    const amt1 = BigInt(rint(2, 6)) * 1_000_000n;
    try {
      await bot.send(A.router, routerAbi, "buyExactIn", [A.yesBook, amt1, 0n, bot.addr, dl]);
      await bot.send(A.router, routerAbi, "buyExactIn", [A.noBook, amt1, 0n, bot.addr, dl]);
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
      await bot.send(A.market, marketAbi, "split", [amt, bot.addr]);
      await bot.send(A.router, routerAbi, "sellExactIn", [A.yesBook, amt, 0n, bot.addr, dl]);
      await bot.send(A.router, routerAbi, "sellExactIn", [A.noBook, amt, 0n, bot.addr, dl]);
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
  // MM recenter loop (live) — keeps books fresh + nudges the price by fair drift
  let mmTimer = null;
  if (cfg.live && !cfg.noMm) {
    mmTimer = setInterval(async () => {
      if (stopping) return;
      // each leg drifts on its OWN flow + noise — independent price discovery
      yesFair = clampP(yesFair + clampD(yesFlow * FLOW_SENS) + (Math.random() - 0.5) * 0.02);
      noFair = clampP(noFair + clampD(noFlow * FLOW_SENS) + (Math.random() - 0.5) * 0.02);
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
        await recenter(mmYes, "YES", yesFair);
        await recenter(mmNo, "NO", noFair);
        log("mm", `YES ${(yesFair * 100).toFixed(1)}¢  NO ${(noFair * 100).toFixed(1)}¢  sum ${((yesFair + noFair) * 100).toFixed(1)}¢`);
      } catch (e) {
        log("mm", "recenter cycle error", safe(e.message).slice(0, 70));
      }
    }, 5000);
  }

  await sleep(cfg.duration * 1000);
  stopping = true;
  clearInterval(sched);
  clearInterval(statTimer);
  if (mmTimer) clearInterval(mmTimer);
  log("stop", "duration reached — draining in-flight…");
  for (let i = 0; i < 30 && M.inflight > 0; i++) await sleep(500);
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
