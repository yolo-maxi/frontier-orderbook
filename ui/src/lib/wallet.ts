import { createWalletClient, custom, parseEther, type PublicClient } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { PrivateKeyAccount } from "viem";
import { isValidFaucetKey, type DeploymentConfig } from "./config";
import { makeChain, makeWalletClient, type DemoWalletClient } from "./chain";

const KEY_STORAGE = "frontier.demoWallet.privateKey";

export interface InjectedConnection {
  address: `0x${string}`;
  wallet: DemoWalletClient;
}

/** Get the injected EIP-1193 provider (MetaMask, Rabby, …), or null. */
export function getInjected(): any {
  return typeof window !== "undefined" ? (window as { ethereum?: unknown }).ethereum : null;
}

/**
 * Connect an injected browser wallet, ensuring it is on the ARC chain (adding it
 * if the wallet doesn't know it yet). Returns the address + a write client that
 * signs through the user's wallet.
 */
export async function connectInjected(cfg: DeploymentConfig): Promise<InjectedConnection> {
  const eth = getInjected();
  if (!eth) throw new Error("No browser wallet found — install MetaMask or a compatible wallet.");
  const accounts: string[] = await eth.request({ method: "eth_requestAccounts" });
  const address = accounts?.[0] as `0x${string}`;
  if (!address) throw new Error("No account authorized.");
  const hexChain = "0x" + cfg.chainId.toString(16);
  try {
    await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hexChain }] });
  } catch (e) {
    const code = (e as { code?: number })?.code;
    if (code === 4902 || /unrecognized|not been added|add this/i.test((e as Error)?.message ?? "")) {
      await eth.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: hexChain,
            chainName: cfg.name || "ARC Testnet",
            nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
            rpcUrls: [cfg.rpcUrl],
          },
        ],
      });
    } else {
      throw e;
    }
  }
  const wallet = createWalletClient({
    account: address,
    chain: makeChain(cfg),
    transport: custom(eth),
  }) as unknown as DemoWalletClient;
  return { address, wallet };
}

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
