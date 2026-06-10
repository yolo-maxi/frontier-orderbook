import { parseEther, type PublicClient } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { PrivateKeyAccount } from "viem";
import { isValidFaucetKey, type DeploymentConfig } from "./config";
import { makeWalletClient } from "./chain";

const KEY_STORAGE = "frontier.demoWallet.privateKey";

export function loadOrCreateAccount(): PrivateKeyAccount {
  let key = localStorage.getItem(KEY_STORAGE);
  if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) {
    key = generatePrivateKey();
    localStorage.setItem(KEY_STORAGE, key);
  }
  return privateKeyToAccount(key as `0x${string}`);
}

export function resetAccount(): PrivateKeyAccount {
  localStorage.removeItem(KEY_STORAGE);
  return loadOrCreateAccount();
}

/**
 * Devnet gas fairy: if the demo wallet is low on native ETH and the
 * deployment ships a funded faucetKey, top the wallet up with 0.5 ETH.
 * Returns true if a top-up was sent.
 */
export async function ensureGas(
  publicClient: PublicClient,
  cfg: DeploymentConfig,
  to: `0x${string}`,
): Promise<boolean> {
  if (!isValidFaucetKey(cfg.faucetKey)) return false;
  const balance = await publicClient.getBalance({ address: to });
  if (balance >= parseEther("0.05")) return false;
  const faucet = privateKeyToAccount(cfg.faucetKey);
  const faucetClient = makeWalletClient(cfg, faucet);
  const hash = await faucetClient.sendTransaction({
    to,
    value: parseEther("0.5"),
  });
  await publicClient.waitForTransactionReceipt({ hash, timeout: 20_000 });
  return true;
}
