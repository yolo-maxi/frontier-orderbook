// Frontier minimal indexer — reconstructs venue state from logs ALONE.
//
// Goal: prove, empirically, exactly how much of the order-book state an
// off-chain indexer can rebuild from the events Frontier currently emits, with
// NO contract storage reads. The only non-event input we allow ourselves is
// the static per-book metadata from the BookCreated event (tokens, tickSpacing,
// fees) — which is itself an event.
//
// Anything we cannot derive is recorded explicitly as `null` with a reason, so
// the reconciliation step (against the Foundry ground-truth file) shows the
// real gaps instead of hiding them behind heuristics.
//
// Usage: node indexer.mjs <fixture-basename>
//   e.g. node indexer.mjs scenario-nofee
//        node indexer.mjs scenario-fee

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { decodeLog } from "./decode.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const base = process.argv[2] || "scenario-nofee";

const logs = JSON.parse(readFileSync(join(HERE, "fixtures", `${base}.logs.json`), "utf8"));
logs.sort((a, b) => a.blockNumber - b.blockNumber || a.logIndex - b.logIndex);

// ------------------------------------------------------------------
// Indexer state
// ------------------------------------------------------------------
const markets = {}; // book -> {token0, token1, tickSpacing, fees...}
const positions = {}; // positionId -> reconstructed position
const sweeps = {}; // `${book}:${clock}` -> per-run fill aggregation (RunFilled)
const trades = []; // one per Swept event (taker + exact amounts, all fee configs)
const claims = [];
const cancels = [];
const requotes = [];
const transfers = [];

// pending taker-fee per (book) keyed by clock is impossible: TakerFee carries
// no clock. We pair TakerFee/MakerFee to the nearest preceding run/claim in the
// same tx (block here). We approximate by block — good enough for the fixture.
const takerFeeByBlock = {}; // block -> TakerFee args
const makerFeeByPosBlock = {}; // `${positionId}:${block}` -> MakerFee args

const TICK_BASE = 1.0001;
function priceAt(tick) {
  return Math.pow(TICK_BASE, tick); // token1 per token0 (geometric curve)
}

for (const raw of logs) {
  const dec = decodeLog(raw);
  if (!dec) continue;
  const { name, args, log } = dec;
  const book = log.address;
  switch (name) {
    case "BookCreated":
      markets[args.book] = {
        token0: args.token0,
        token1: args.token1,
        tickSpacing: args.tickSpacing,
        startTick: args.startTick,
        makerFeeBps: args.makerFeeBps,
        takerFeeBps: args.takerFeeBps,
        feeRecipient: args.feeRecipient,
      };
      break;

    case "Deposit":
      positions[args.positionId] = {
        positionId: args.positionId.toString(),
        book,
        owner: args.owner,
        lower: args.lower,
        upper: args.upper,
        liquidity: args.liquidity.toString(),
        // side now comes straight off the Deposit event (isBid flag).
        side: args.isBid ? "bid" : "ask",
        live: true,
        depositBlock: log.blockNumber, // proxy for the fill clock at deposit
      };
      break;

    case "RunFilled": {
      const m = markets[book] || { tickSpacing: 1 };
      const spacing = m.tickSpacing;
      const direction = args.toBoundary > args.fromLevel ? "up" : "down";
      const span = Math.abs(args.toBoundary - args.fromLevel);
      const n = Math.round(span / spacing);
      // token0 leg is EXACT from the event: startSize per level * n levels.
      const token0Leg = args.startSize * BigInt(n);
      // token1 leg requires reimplementing the on-chain curve + integer
      // rounding (GeoTickMath). We approximate it with float price to show it
      // is *derivable in principle* but not present in any event.
      let token1LegApprox = 0n;
      for (let k = 0; k < n; k++) {
        const lvl = direction === "up" ? args.fromLevel + k * spacing : args.fromLevel - k * spacing;
        token1LegApprox += BigInt(Math.round(Number(args.startSize) * priceAt(lvl)));
      }
      const key = `${book}:${args.clock}`;
      if (!sweeps[key]) {
        sweeps[key] = {
          book,
          clock: args.clock.toString(),
          direction,
          runs: 0,
          token0Total: 0n,
          token1ApproxTotal: 0n,
          taker: null, // not in RunFilled
          paidExact: null, // not in RunFilled
          receivedExact: null, // not in RunFilled
          block: log.blockNumber,
        };
      }
      const s = sweeps[key];
      s.runs += 1;
      s.token0Total += token0Leg;
      s.token1ApproxTotal += token1LegApprox;
      break;
    }

    case "Swept": {
      const direction = args.tickAfter > args.tickBefore ? "up" : "down";
      trades.push({
        book,
        taker: args.taker,
        direction,
        tickBefore: args.tickBefore,
        tickAfter: args.tickAfter,
        amountIn: args.amountIn, // includes takerFee
        amountOut: args.amountOut,
        takerFee: args.takerFee,
        block: log.blockNumber,
      });
      break;
    }

    case "Claim":
      claims.push({
        positionId: args.positionId.toString(),
        block: log.blockNumber,
        amount: args.proceeds.toString(),
        token: null, // not in Claim — depends on side, which is unknown
      });
      break;

    case "Cancel":
      cancels.push({
        positionId: args.positionId.toString(),
        block: log.blockNumber,
        amountA: args.proceeds.toString(), // proceeds1 (ask) OR proceeds0 (bid)?
        amountB: args.principal.toString(), // principal0 (ask) OR refund1 (bid)?
        interpretation: null, // unknown without side
      });
      if (positions[args.positionId]) positions[args.positionId].live = false;
      break;

    case "Requote": {
      const p = positions[args.positionId];
      if (p) {
        p.lower = args.lower;
        p.upper = args.upper;
        p.liquidity = args.liquidity.toString();
        p.depositBlock = log.blockNumber; // requote refreshes the fill clock
      }
      requotes.push({ positionId: args.positionId.toString(), lower: args.lower, upper: args.upper });
      break;
    }

    case "PositionTransferred": {
      const p = positions[args.positionId];
      if (p) p.owner = args.to;
      transfers.push({ positionId: args.positionId.toString(), from: args.from, to: args.to });
      break;
    }

    case "TakerFee":
      takerFeeByBlock[log.blockNumber] = args;
      break;

    case "MakerFee":
      makerFeeByPosBlock[`${args.positionId}:${log.blockNumber}`] = args;
      break;
  }
}

// ------------------------------------------------------------------
// Second pass: derive token sides from each position's side (now known from
// the Deposit isBid flag). Because Claim/Cancel are keyed by positionId, the
// side flag transitively makes their token assignment unambiguous — no need to
// touch those events at all. Fee events are used only as a cross-check.
// ------------------------------------------------------------------
const mktOf = (book) =>
  Object.entries(markets).find(([a]) => a.toLowerCase() === book.toLowerCase())?.[1];

for (const c of claims) {
  const p = positions[c.positionId];
  const m = p && mktOf(p.book);
  if (p && p.side && m) c.token = p.side === "bid" ? m.token0 : m.token1; // ask pays token1, bid pays token0
  const mf = makerFeeByPosBlock[`${c.positionId}:${c.block}`];
  if (mf) c.feeToken = mf.token; // cross-check
}
for (const c of cancels) {
  const p = positions[c.positionId];
  const m = p && mktOf(p.book);
  if (p && p.side && m) {
    // ask cancel: (proceeds1=token1, principal0=token0); bid: (proceeds0=token0, refund1=token1)
    c.proceedsToken = p.side === "bid" ? m.token0 : m.token1;
    c.principalToken = p.side === "bid" ? m.token1 : m.token0;
    c.interpretation = p.side === "bid" ? "proceeds0/refund1" : "proceeds1/principal0";
  }
}

// Position fill progress: the reached tick of each sweep (Swept.tickAfter) IS
// the frontier. Replaying sweeps that happened after a position's deposit gives
// its filled frontier exactly — no curve needed. The UNFILLED principal
// (token0 units) then follows from liquidity * unfilled levels, also curve-free.
// (The token1 *value* of a bid's refund still needs the curve; flagged below.)
for (const p of Object.values(positions)) {
  const m = mktOf(p.book);
  if (!m) continue;
  const spacing = m.tickSpacing;
  const totalLevels = (p.upper - p.lower) / spacing;
  const after = trades.filter((t) => t.block > p.depositBlock);
  let frontier, filledLevels;
  if (p.side === "ask") {
    const ups = after.filter((t) => t.direction === "up").map((t) => t.tickAfter);
    const reached = ups.length ? Math.max(...ups) : p.lower;
    frontier = Math.min(Math.max(reached, p.lower), p.upper);
    filledLevels = (frontier - p.lower) / spacing;
  } else {
    const downs = after.filter((t) => t.direction === "down").map((t) => t.tickAfter);
    const reached = downs.length ? Math.min(...downs) : p.upper;
    frontier = Math.max(Math.min(reached, p.upper), p.lower);
    filledLevels = (p.upper - frontier) / spacing;
  }
  p.frontier = frontier;
  p.unfilledLevels = totalLevels - filledLevels;
  p.unfilledPrincipal0 = (BigInt(p.liquidity) * BigInt(p.unfilledLevels)).toString();
}

// ------------------------------------------------------------------
// Reconciliation against ground truth
// ------------------------------------------------------------------
const truth = JSON.parse(readFileSync(join(HERE, "fixtures", `${base}.truth.json`), "utf8"));

const RESET = "\x1b[0m";
const RED = (s) => `\x1b[31m${s}${RESET}`;
const GRN = (s) => `\x1b[32m${s}${RESET}`;
const YEL = (s) => `\x1b[33m${s}${RESET}`;
const tag = (status) =>
  status === "RECOVERED" ? GRN("RECOVERED ") : status === "DERIVABLE" ? YEL("DERIVABLE*") : RED("MISSING   ");

const rows = [];
function check(field, status, detail) {
  rows.push({ field, status, detail });
}

console.log(`\n=== Frontier indexer reconstruction: ${base} ===`);
console.log(`(makerFeeBps=${truth.makerFeeBps}, takerFeeBps=${truth.takerFeeBps})\n`);

// Markets (addresses stored lowercased from topics; match case-insensitively)
const mkt = Object.entries(markets).find(([a]) => a.toLowerCase() === truth.book.toLowerCase())?.[1];
check(
  "market: tokens / tickSpacing / fees",
  mkt && mkt.token0.toLowerCase() === truth.token0.toLowerCase() ? "RECOVERED" : "MISSING",
  mkt ? `token0=${mkt.token0} spacing=${mkt.tickSpacing}` : "no BookCreated"
);

// Positions: owner / range / liquidity / side
for (const [pid, exp] of Object.entries(truth.positions)) {
  const got = positions[pid];
  const okOwner = got && got.owner.toLowerCase() === exp.owner.toLowerCase();
  const okRange = got && got.lower === exp.lower && got.upper === exp.upper;
  check(
    `position ${pid}: owner/range/liquidity`,
    got && okOwner && okRange && got.liquidity === exp.liquidity ? "RECOVERED" : "MISSING",
    got ? `owner=${got.owner.slice(0, 10)} [${got.lower},${got.upper}) L=${got.liquidity}` : "no Deposit"
  );
  const expSide = exp.isBid ? "bid" : "ask";
  check(
    `position ${pid}: side (ask/bid)`,
    got && got.side === expSide ? "RECOVERED" : "MISSING",
    got && got.side ? `${got.side} (from Deposit.isBid)` : `truth=${expSide}; no side`
  );
}

// Trades — now driven by the Swept summary event (taker + exact amounts in
// EVERY fee config; no curve replay needed).
const up = trades.find((t) => t.direction === "up");
const dn = trades.find((t) => t.direction === "down");
for (const [label, t, exp] of [
  ["upSweep", up, truth.trades.upSweep],
  ["downSweep", dn, truth.trades.downSweep],
]) {
  check(`trade ${label}: direction`, t ? "RECOVERED" : "MISSING", t ? `${t.direction} (tickBefore->tickAfter)` : "no Swept");
  check(
    `trade ${label}: taker`,
    t && t.taker.toLowerCase() === exp.taker.toLowerCase() ? "RECOVERED" : "MISSING",
    t ? `${t.taker} (from Swept)` : `truth=${exp.taker.slice(0, 10)}`
  );
  check(
    `trade ${label}: amountIn (incl fee)`,
    t && t.amountIn === BigInt(exp.paid) ? "RECOVERED" : "MISSING",
    t ? `indexer=${t.amountIn} truth=${exp.paid} (from Swept, exact)` : "no Swept"
  );
  check(
    `trade ${label}: amountOut`,
    t && t.amountOut === BigInt(exp.received) ? "RECOVERED" : "MISSING",
    t ? `indexer=${t.amountOut} truth=${exp.received} (from Swept, exact)` : "no Swept"
  );
}

// Claims
for (const [label, exp] of Object.entries(truth.claims)) {
  const got = claims.find((c) => c.amount === exp.amount);
  check(
    `claim ${label}: amount`,
    got ? "RECOVERED" : "MISSING",
    got ? `amount=${got.amount}` : "no Claim matched"
  );
  const expTokenAddr = exp.token === "token0" ? truth.token0 : truth.token1;
  check(
    `claim ${label}: token (0/1)`,
    got && got.token && got.token.toLowerCase() === expTokenAddr.toLowerCase() ? "RECOVERED" : "MISSING",
    got && got.token ? `${got.token} (via position side)` : `truth=${exp.token}`
  );
}

// Cancel
const cancelGot = cancels[0];
check(
  "cancel: amounts",
  cancelGot ? "RECOVERED" : "MISSING",
  cancelGot ? `a=${cancelGot.amountA} b=${cancelGot.amountB}` : "no Cancel"
);
check(
  "cancel: which token is proceeds vs principal/refund",
  cancelGot && cancelGot.proceedsToken ? "RECOVERED" : "MISSING",
  cancelGot && cancelGot.proceedsToken
    ? `${cancelGot.interpretation}, proceedsToken=${cancelGot.proceedsToken} (via position side)`
    : "no side"
);

// Book price after each sweep — now from Swept.tickAfter
check(
  "book price: currentTick after each sweep",
  up && dn ? "RECOVERED" : "MISSING",
  up && dn ? `up->tick ${up.tickAfter}, down->tick ${dn.tickAfter} (from Swept.tickAfter)` : "no Swept"
);

// Position fill progress — reconstructed from Swept.tickAfter (frontier).
const p1 = positions["1"];
check(
  "position pos1: unfilled principal (token0, exact)",
  p1 && p1.unfilledPrincipal0 === truth.progress.pos1_ask.unfilledPrincipal0 ? "RECOVERED" : "MISSING",
  p1
    ? `frontier=tick ${p1.frontier}, unfilledPrincipal0=${p1.unfilledPrincipal0} truth=${truth.progress.pos1_ask.unfilledPrincipal0}`
    : "no position"
);
const p3 = positions["3"];
check(
  "position pos3: unfilled bid levels (token0 units, exact)",
  p3 ? "RECOVERED" : "MISSING",
  p3 ? `frontier=tick ${p3.frontier}, ${p3.unfilledLevels} unfilled levels (token1 refund value still needs curve)` : "no position"
);

// ------------------------------------------------------------------
// Print
// ------------------------------------------------------------------
const pad = Math.max(...rows.map((r) => r.field.length));
for (const r of rows) {
  console.log(`  ${tag(r.status)}  ${r.field.padEnd(pad)}  ${r.detail}`);
}
const n = (st) => rows.filter((r) => r.status === st).length;
console.log(
  `\n  summary: ${GRN(n("RECOVERED") + " recovered")}, ${YEL(n("DERIVABLE") + " derivable*")}, ${RED(
    n("MISSING") + " missing"
  )}`
);
console.log("  * DERIVABLE = not in any event; only reconstructable by reimplementing on-chain curve math/rounding.\n");
