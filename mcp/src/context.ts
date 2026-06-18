import {
  createPublicClient,
  createWalletClient,
  http,
  type Account,
  type Address,
  type Chain,
  type PublicClient,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

/**
 * Runtime context for the Frontier MCP server, assembled from environment
 * variables. A wallet (private key) is optional: without it, only read/quote
 * and simulation tools are usable; write tools return calldata for the caller
 * to sign and broadcast elsewhere.
 *
 * Env vars:
 *   FRONTIER_RPC_URL        (required) JSON-RPC endpoint
 *   FRONTIER_CHAIN_ID       (optional) chain id, default derived from RPC
 *   FRONTIER_FACTORY        (optional) FrontierGeoBookFactory address
 *   FRONTIER_ROUTER         (optional) FrontierRouter address
 *   FRONTIER_LENS           (optional) FrontierLens address
 *   FRONTIER_REGISTRY       (optional) PermissionRegistry address
 *   FRONTIER_BOOK           (optional) default GeometricFrontierBook address
 *   FRONTIER_PRIVATE_KEY    (optional) 0x-private key enabling write/execute
 */
export interface FrontierContext {
  publicClient: PublicClient;
  walletClient?: WalletClient;
  account?: Account;
  chain?: Chain;
  addresses: {
    factory?: Address;
    router?: Address;
    lens?: Address;
    registry?: Address;
    book?: Address;
  };
}

function optAddr(name: string): Address | undefined {
  const v = process.env[name];
  if (!v) return undefined;
  if (!/^0x[0-9a-fA-F]{40}$/.test(v)) {
    throw new Error(`${name} is not a valid address: ${v}`);
  }
  return v as Address;
}

/**
 * Validate an RPC URL: it must parse and use the http(s) protocol. Errors never
 * include the raw URL because RPC endpoints commonly embed API keys / basic-auth
 * credentials that must not be logged.
 */
export function validateRpcUrl(raw: string | undefined, varName: string): string {
  if (!raw) {
    throw new Error(`${varName} is required to start the Frontier MCP server`);
  }
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`${varName} is not a valid URL (must be an absolute http(s) URL)`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(
      `${varName} must use http(s) (got protocol "${parsed.protocol.replace(/:$/, "")}")`,
    );
  }
  return raw;
}

export function buildContext(): FrontierContext {
  const rpcUrl = validateRpcUrl(process.env.FRONTIER_RPC_URL, "FRONTIER_RPC_URL");

  const chainId = process.env.FRONTIER_CHAIN_ID ? Number(process.env.FRONTIER_CHAIN_ID) : undefined;
  const chain: Chain | undefined = chainId
    ? {
        id: chainId,
        name: `chain-${chainId}`,
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
        rpcUrls: { default: { http: [rpcUrl] } },
      }
    : undefined;

  const publicClient = createPublicClient({ chain, transport: http(rpcUrl) }) as PublicClient;

  let account: Account | undefined;
  let walletClient: WalletClient | undefined;
  const pk = process.env.FRONTIER_PRIVATE_KEY;
  if (pk) {
    const normalized = (pk.startsWith("0x") ? pk : `0x${pk}`) as `0x${string}`;
    account = privateKeyToAccount(normalized);
    walletClient = createWalletClient({ account, chain, transport: http(rpcUrl) });
  }

  return {
    publicClient,
    walletClient,
    account,
    chain,
    addresses: {
      factory: optAddr("FRONTIER_FACTORY"),
      router: optAddr("FRONTIER_ROUTER"),
      lens: optAddr("FRONTIER_LENS"),
      registry: optAddr("FRONTIER_REGISTRY"),
      book: optAddr("FRONTIER_BOOK"),
    },
  };
}

/** Resolve an address argument, falling back to a configured default. */
export function resolveAddress(
  arg: string | undefined,
  fallback: Address | undefined,
  label: string,
): Address {
  const v = arg ?? fallback;
  if (!v) {
    throw new Error(
      `No ${label} address provided and none configured. Pass it explicitly or set the corresponding FRONTIER_* env var.`,
    );
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(v)) throw new Error(`${label} is not a valid address: ${v}`);
  return v as Address;
}
