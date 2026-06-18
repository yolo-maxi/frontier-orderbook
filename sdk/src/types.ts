import type { Address, Hex } from "viem";

/**
 * Addresses of a deployed Frontier venue. These come from the deployment JSON
 * written by `prototype/script/DeployFrontier.s.sol`.
 */
export interface FrontierDeployment {
  /** Optional human label, e.g. "Frontier" or "frontier-base-sepolia". */
  name?: string;
  /** EVM chain id the venue is deployed on. */
  chainId: number;
  /** FrontierGeoBookFactory. */
  factory: Address;
  /** FrontierLens read-only quote/depth helper. */
  lens: Address;
  /** FrontierRouter exact-input taker periphery. */
  router: Address;
  /** PermissionRegistry selector-scoped delegation registry. */
  registry: Address;
  /** The primary GeometricFrontierBook created at deploy time (optional). */
  book?: Address;
  /** Fee config recorded at deploy time (optional, informational). */
  feeRecipient?: Address;
  makerFeeBps?: number;
  takerFeeBps?: number;
}

/** Side of a resting maker order. */
export type Side = "ask" | "bid";

/** Direction of a taker swap. */
export type TakeDirection = "buy" | "sell";

/** Decoded on-chain position record from `GeometricFrontierBook.positions`. */
export interface Position {
  owner: Address;
  lower: number;
  upper: number;
  liquidity: bigint;
  depositClock: bigint;
  claimedUpper: number;
  live: boolean;
  isBid: boolean;
}

/** Book configuration as read from the chain. */
export interface BookConfig {
  address: Address;
  token0: Address;
  token1: Address;
  tickSpacing: number;
  currentTick: number;
  feeRecipient: Address;
  makerFeeBps: number;
  takerFeeBps: number;
  hooks: Address;
  permissions: Address;
}

/** A single depth level from `FrontierLens.depth`. */
export interface DepthLevel {
  tick: number;
  askSize: bigint;
  bidSize: bigint;
}

/** Result of a quote from `FrontierLens.quoteBuy` / `quoteSell`. */
export interface Quote {
  /** Output token amount (token0 for a buy, token1 for a sell). */
  amountOut: bigint;
  /** Input token amount actually consumed. */
  amountSpent: bigint;
  /** Tick the frontier would end on. */
  endTick: number;
}

/** Lens book summary. */
export interface BookSummary {
  currentTick: number;
  tickSpacing: number;
  token0: Address;
  token1: Address;
  bestAsk: number;
  bestBid: number;
}

/** Parameters for creating a geometric market. */
export interface CreateMarketParams {
  token0: Address;
  token1: Address;
  tickSpacing: number;
  startTick: number;
  /** Required when either fee is non-zero. */
  feeRecipient?: Address;
  makerFeeBps?: number;
  takerFeeBps?: number;
}

/** A taker swap request through the router. */
export interface SwapParams {
  /** Exact input amount (token1 for a buy, token0 for a sell). */
  amountIn: bigint;
  /** Minimum acceptable output. Use {@link applySlippage} to derive. */
  minOut: bigint;
  /** Recipient of the output tokens. Defaults to the caller. */
  to?: Address;
  /** Unix-seconds deadline. Defaults to now + 5 minutes. */
  deadline?: bigint;
}

/** Common shape returned by write helpers. */
export interface TxResult {
  hash: Hex;
}
