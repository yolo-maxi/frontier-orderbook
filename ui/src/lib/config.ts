export interface DeploymentContracts {
  book: `0x${string}`;
  factory: `0x${string}`;
  router: `0x${string}`;
  lens: `0x${string}`;
  registry: `0x${string}`;
  lpFactory: `0x${string}`;
  yieldVault: `0x${string}`;
  weth: `0x${string}`;
  usdc: `0x${string}`;
}

export interface DeploymentTokens {
  base?: string;
  quote?: string;
  baseAddress?: `0x${string}`;
  quoteAddress?: `0x${string}`;
  baseDecimals?: number;
  quoteDecimals?: number;
}

export interface DeploymentConfig {
  name: string;
  chainId: number;
  rpcUrl: string;
  faucetKey?: string;
  contracts: DeploymentContracts;
  tokens?: DeploymentTokens;
  darkbox?: {
    network?: string;
    marketFactory?: `0x${string}`;
    syntheticUSDC?: `0x${string}`;
    selectedSide?: string;
    category?: string;
    subtitle?: string;
    resolutionSource?: string;
    market?: {
      question?: string;
      market?: `0x${string}`;
      marketId?: string;
      yesBook?: `0x${string}`;
      noBook?: `0x${string}`;
      yesToken?: `0x${string}`;
      noToken?: `0x${string}`;
    };
  };
}

export const marketQuestion = (cfg: DeploymentConfig) => cfg.darkbox?.market?.question ?? cfg.name;
export const baseSymbol = (cfg: DeploymentConfig) => cfg.tokens?.base ?? "YES";
export const quoteSymbol = (cfg: DeploymentConfig) => cfg.tokens?.quote ?? "USDC";
export const baseDecimals = (cfg: DeploymentConfig) => cfg.tokens?.baseDecimals ?? 6;
export const quoteDecimals = (cfg: DeploymentConfig) => cfg.tokens?.quoteDecimals ?? 6;

const nonZero = (a: string | undefined): a is `0x${string}` => !!a && !/^0x0*$/.test(a);

/** Address of the prediction-market vault (split/merge/redeem), or null. */
export const marketVaultAddr = (cfg: DeploymentConfig): `0x${string}` | null =>
  nonZero(cfg.darkbox?.market?.market) ? (cfg.darkbox!.market!.market as `0x${string}`) : null;
export const yesBookAddr = (cfg: DeploymentConfig): `0x${string}` =>
  (nonZero(cfg.darkbox?.market?.yesBook) ? cfg.darkbox!.market!.yesBook! : cfg.contracts.book) as `0x${string}`;
export const noBookAddr = (cfg: DeploymentConfig): `0x${string}` | null =>
  nonZero(cfg.darkbox?.market?.noBook) ? (cfg.darkbox!.market!.noBook as `0x${string}`) : null;
export const yesTokenAddr = (cfg: DeploymentConfig): `0x${string}` =>
  (nonZero(cfg.darkbox?.market?.yesToken) ? cfg.darkbox!.market!.yesToken! : cfg.contracts.weth) as `0x${string}`;
export const noTokenAddr = (cfg: DeploymentConfig): `0x${string}` | null =>
  nonZero(cfg.darkbox?.market?.noToken) ? (cfg.darkbox!.market!.noToken as `0x${string}`) : null;
export const collateralAddr = (cfg: DeploymentConfig): `0x${string}` => cfg.contracts.usdc;

export const marketCategory = (cfg: DeploymentConfig) => cfg.darkbox?.category ?? "Crypto · Price";
export const marketResolutionSource = (cfg: DeploymentConfig) =>
  cfg.darkbox?.resolutionSource ?? "Frontier resolver · market outcome";

const ZERO = /^0x0*$/;

export function isZeroAddress(a: string | undefined): boolean {
  return !a || ZERO.test(a);
}

/** True when the essential contracts have real addresses. */
export function isConfigured(cfg: DeploymentConfig): boolean {
  const c = cfg.contracts;
  return (
    !isZeroAddress(c.book) &&
    !isZeroAddress(c.lens) &&
    !isZeroAddress(c.router) &&
    !isZeroAddress(c.weth) &&
    !isZeroAddress(c.usdc)
  );
}

export function isValidFaucetKey(k: string | undefined): k is `0x${string}` {
  return !!k && /^0x[0-9a-fA-F]{64}$/.test(k) && !ZERO.test(k);
}

export async function loadConfig(): Promise<DeploymentConfig> {
  const res = await fetch("./deployment.json", { cache: "no-store" });
  if (!res.ok) throw new Error(`deployment.json: HTTP ${res.status}`);
  const cfg = (await res.json()) as DeploymentConfig;
  if (!cfg.rpcUrl || !cfg.chainId || !cfg.contracts) {
    throw new Error("deployment.json: missing rpcUrl/chainId/contracts");
  }
  return cfg;
}
