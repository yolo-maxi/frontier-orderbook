#!/usr/bin/env node
// One-off: brute-force scan every position on the YES and NO books and cancel
// any LIVE out-of-band order (lower tick > 1000, i.e. resting near the book's
// construction tick at price ~4.85e8) owned by our demo bots. These orphans —
// left by very early runs before reclaim() existed — let aggressive buys sweep
// the frontier out of the (0,1) band. Killing them keeps the book stable.
import {
  loadDeployment,
  loadEnvFile,
  makeChain,
  makePublic,
  makeBot,
  deriveBotKeys,
  bookAbi,
  log,
  safe,
} from "./dbx-lib.mjs";

const dep = loadDeployment();
const env = loadEnvFile(process.argv.includes("--env") ? process.argv[process.argv.indexOf("--env") + 1] : "/home/xiko/darkbox/.secrets/arc-testnet-submission.env");
const rpc = env.ARC_RPC_URL || dep.rpcUrl;
const chain = makeChain(dep, rpc);
const pub = makePublic(chain, rpc);
const bots = deriveBotKeys(12).map((k) => makeBot(k, chain, rpc, pub));
const ownerMap = new Map(bots.map((b) => [b.addr.toLowerCase(), b]));
// --all also cancels IN-BAND positions (stranded bids/asks that deadlock a
// downward moveTickTo); default only clears clearly out-of-band orphans.
const ALL = process.argv.includes("--all");

const BOOKS = { YES: dep.darkbox.market.yesBook, NO: dep.darkbox.market.noBook };

for (const [name, book] of Object.entries(BOOKS)) {
  const npid = Number(await pub.readContract({ address: book, abi: bookAbi, functionName: "nextPositionId" }));
  log("clean", `${name} (${book.slice(0, 10)}…) scanning ${npid} positions…`);
  let cancelled = 0;
  let foreign = 0;
  for (let id = 1n; id < BigInt(npid); id++) {
    let p;
    try {
      p = await pub.readContract({ address: book, abi: bookAbi, functionName: "positions", args: [id] });
    } catch {
      continue;
    }
    const owner = p[0];
    const lower = p[1];
    const live = p[7];
    const isBid = p[8];
    if (!live) continue;
    if (!ALL && Number(lower) <= 1000) continue; // default: keep in-band orders
    const bot = ownerMap.get(owner.toLowerCase());
    if (!bot) {
      foreign++;
      log("clean", `  pos ${id} orphan @tick ${lower} owned by ${owner.slice(0, 10)}… (not ours — cannot cancel)`);
      continue;
    }
    try {
      try {
        await bot.send(book, bookAbi, isBid ? "cancelBid" : "cancel", [id]);
      } catch {
        await bot.send(book, bookAbi, isBid ? "cancelBidWithWitness" : "cancelWithWitness", [id, lower]);
      }
      cancelled++;
      log("clean", `  cancelled pos ${id} (${isBid ? "bid" : "ask"} @tick ${lower})`);
    } catch (e) {
      log("clean", `  pos ${id} cancel FAILED: ${safe(e.shortMessage || e.message || "").slice(0, 60)}`);
    }
  }
  const ct = await pub.readContract({ address: book, abi: bookAbi, functionName: "currentTick" });
  log("clean", `${name}: cancelled ${cancelled} orphan(s), ${foreign} foreign left; currentTick now ${ct}`);
}
process.exit(0);
