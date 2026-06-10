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

export interface DeploymentConfig {
  name: string;
  chainId: number;
  rpcUrl: string;
  faucetKey?: string;
  contracts: DeploymentContracts;
}

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
