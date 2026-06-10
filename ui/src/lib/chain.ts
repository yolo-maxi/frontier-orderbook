import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  type Chain,
  type PublicClient,
  type WalletClient,
  type Account,
  type Transport,
} from "viem";
import type { DeploymentConfig } from "./config";

export function makeChain(cfg: DeploymentConfig): Chain {
  return defineChain({
    id: cfg.chainId,
    name: cfg.name || "Frontier Devnet",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [cfg.rpcUrl] } },
  });
}

export function makePublicClient(cfg: DeploymentConfig): PublicClient {
  return createPublicClient({
    chain: makeChain(cfg),
    transport: http(cfg.rpcUrl, { timeout: 8_000, retryCount: 1 }),
  });
}

export type DemoWalletClient = WalletClient<Transport, Chain, Account>;

export function makeWalletClient(
  cfg: DeploymentConfig,
  account: Account,
): DemoWalletClient {
  return createWalletClient({
    account,
    chain: makeChain(cfg),
    transport: http(cfg.rpcUrl, { timeout: 8_000, retryCount: 1 }),
  });
}
