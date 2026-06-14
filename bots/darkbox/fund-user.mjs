#!/usr/bin/env node
// Mint sUSDC + send a little gas to a user address so they can trade in the UI.
// Uses the deployer key (the authorized sUSDC minter) from the .secrets env —
// the key stays in memory and is never printed.
//   node fund-user.mjs <address> [sUSDC=10000] [gasEth=0.1]
import { loadDeployment, loadEnvFile, makeChain, makePublic, makeBot, erc20Abi, log } from "./dbx-lib.mjs";
import { parseUnits, formatUnits } from "viem";

const USER = process.argv[2];
const USDC_AMT = process.argv[3] || "10000";
const GAS_ETH = process.argv[4] || "0.1";
if (!/^0x[0-9a-fA-F]{40}$/.test(USER || "")) {
  console.error("usage: node fund-user.mjs <0xaddress> [sUSDC] [gasEth]");
  process.exit(1);
}

const dep = loadDeployment();
const env = loadEnvFile("/home/xiko/darkbox/.secrets/arc-testnet-submission.env");
const rpc = env.ARC_RPC_URL || dep.rpcUrl;
const chain = makeChain(dep, rpc);
const pub = makePublic(chain, rpc);
if (!env.DEPLOYER_KEY) {
  console.error("DEPLOYER_KEY not found in env");
  process.exit(1);
}
const treasury = makeBot(env.DEPLOYER_KEY, chain, rpc, pub);
const usdc = dep.contracts.usdc;

const [usdcBefore, ethBefore] = await Promise.all([
  pub.readContract({ address: usdc, abi: erc20Abi, functionName: "balanceOf", args: [USER] }),
  pub.getBalance({ address: USER }),
]);
log("fund", `treasury ${treasury.addr} (sUSDC minter)`);
log("fund", `user ${USER} before: ${formatUnits(usdcBefore, 6)} sUSDC, ${formatUnits(ethBefore, 18)} ETH`);

await treasury.send(usdc, erc20Abi, "mint", [USER, parseUnits(USDC_AMT, 6)]);
log("fund", `minted ${USDC_AMT} sUSDC -> ${USER}`);
await treasury.sendValue(USER, parseUnits(GAS_ETH, 18));
log("fund", `sent ${GAS_ETH} ETH gas -> ${USER}`);

const [usdcAfter, ethAfter] = await Promise.all([
  pub.readContract({ address: usdc, abi: erc20Abi, functionName: "balanceOf", args: [USER] }),
  pub.getBalance({ address: USER }),
]);
log("fund", `user ${USER} after:  ${formatUnits(usdcAfter, 6)} sUSDC, ${formatUnits(ethAfter, 18)} ETH`);
process.exit(0);
