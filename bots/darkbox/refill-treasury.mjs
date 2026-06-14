#!/usr/bin/env node
// Refill the deployer treasury's GAS from the MAKER account (both in .secrets).
// Only ETH is moved; no keys are printed.  node refill-treasury.mjs [eth=15]
import { loadDeployment, loadEnvFile, makeChain, makePublic, makeBot, log } from "./dbx-lib.mjs";
import { parseEther, formatEther } from "viem";

const dep = loadDeployment();
const env = loadEnvFile("/home/xiko/darkbox/.secrets/arc-testnet-submission.env");
const rpc = env.ARC_RPC_URL || dep.rpcUrl;
const chain = makeChain(dep, rpc);
const pub = makePublic(chain, rpc);
const DEPLOYER = "0xCa1370C6226A867BE549A0aEB613f27BdD11370B";
const amt = process.argv[2] || "15";
const srcKey = process.argv[3] === "TAKER" ? env.TAKER_KEY : env.MAKER_KEY;
if (!srcKey) {
  console.error("source key missing");
  process.exit(1);
}
const maker = makeBot(srcKey, chain, rpc, pub);
log("refill", `maker ${maker.addr}: ${formatEther(await pub.getBalance({ address: maker.addr }))} ETH`);
await maker.sendValue(DEPLOYER, parseEther(amt));
log("refill", `sent ${amt} ETH -> deployer; deployer now ${formatEther(await pub.getBalance({ address: DEPLOYER }))} ETH`);
process.exit(0);
