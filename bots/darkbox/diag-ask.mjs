// Diagnose why the YES ask deposit reverts: read cur, simulate the exact deposit
// the maker makes, and print the FULL revert reason (not the 60-char truncation).
import { loadDeployment, loadEnvFile, makeChain, makePublic, makeBot, deriveBotKeys, bookAbi, erc20Abi } from "./dbx-lib.mjs";

const dep = loadDeployment();
const env = loadEnvFile("/home/xiko/darkbox/.secrets/arc-testnet-submission.env");
const rpc = env.ARC_RPC_URL || dep.rpcUrl;
const chain = makeChain(dep, rpc);
const pub = makePublic(chain, rpc);
const mmYes = makeBot(deriveBotKeys(12)[0], chain, rpc, pub);
const book = dep.darkbox.market.yesBook;
const token = dep.darkbox.market.yesToken;

const cur = Number(await pub.readContract({ address: book, abi: bookAbi, functionName: "currentTick" }));
const bal = await pub.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [mmYes.addr] });
const allow = await pub.readContract({ address: token, abi: erc20Abi, functionName: "allowance", args: [mmYes.addr, book] });
console.log("cur:", cur, "price:", (1.0001 ** cur).toFixed(4));
console.log("mmYes YES-share balance:", bal.toString(), "allowance:", allow.toString());

const OFFSET = 40, LADDER = 320, askBase = 2000000n;
const askLo = cur + OFFSET;
for (const [label, lo, hi, fn] of [
  ["ask deposit", askLo, askLo + LADDER, "deposit"],
  ["narrow ask", askLo, askLo + 60, "deposit"],
]) {
  try {
    const sim = await pub.simulateContract({ address: book, abi: bookAbi, functionName: fn, args: [lo, hi, askBase], account: mmYes.account });
    console.log(`${label} [${lo},${hi}] base ${askBase}: OK -> id ${sim.result}`);
  } catch (e) {
    console.log(`${label} [${lo},${hi}]: REVERT -> ${(e.shortMessage || e.message || "").slice(0, 220)}`);
  }
}
// also try a tiny base in case it's an amount/precision issue
try {
  const sim = await pub.simulateContract({ address: book, abi: bookAbi, functionName: "deposit", args: [askLo, askLo + LADDER, 100000n], account: mmYes.account });
  console.log(`tiny base 100000: OK -> id ${sim.result}`);
} catch (e) {
  console.log(`tiny base 100000: REVERT -> ${(e.shortMessage || e.message || "").slice(0, 220)}`);
}
process.exit(0);
