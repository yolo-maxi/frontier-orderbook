import { FEE_BPS_DENOMINATOR, TICK_BASE } from "./constants.js";

/**
 * Apply a downward slippage tolerance to an expected output amount and return
 * the minimum acceptable output (rounded down).
 *
 * @param expectedOut quoted output amount
 * @param slippageBps tolerance in basis points (e.g. 50 = 0.50%)
 */
export function applySlippage(expectedOut: bigint, slippageBps: number): bigint {
  if (slippageBps < 0 || slippageBps > 10_000) {
    throw new Error(`slippageBps out of range: ${slippageBps}`);
  }
  const keepBps = FEE_BPS_DENOMINATOR - BigInt(Math.floor(slippageBps));
  return (expectedOut * keepBps) / FEE_BPS_DENOMINATOR;
}

/** Add a taker fee (in bps) on top of a gross input to get the total to approve. */
export function grossInputWithTakerFee(grossInput: bigint, takerFeeBps: number): bigint {
  const fee = (grossInput * BigInt(takerFeeBps)) / FEE_BPS_DENOMINATOR;
  return grossInput + fee;
}

/** Subtract a maker fee (in bps) from gross proceeds to get net proceeds. */
export function netProceedsAfterMakerFee(grossProceeds: bigint, makerFeeBps: number): bigint {
  const fee = (grossProceeds * BigInt(makerFeeBps)) / FEE_BPS_DENOMINATOR;
  return grossProceeds - fee;
}

/** True if a tick is aligned to the given spacing. */
export function isTickAligned(tick: number, tickSpacing: number): boolean {
  if (tickSpacing <= 0) return false;
  return tick % tickSpacing === 0;
}

/** Round a tick down to the nearest spacing-aligned tick (toward -inf). */
export function floorToSpacing(tick: number, tickSpacing: number): number {
  return Math.floor(tick / tickSpacing) * tickSpacing;
}

/** Round a tick up to the nearest spacing-aligned tick (toward +inf). */
export function ceilToSpacing(tick: number, tickSpacing: number): number {
  return Math.ceil(tick / tickSpacing) * tickSpacing;
}

/**
 * Convert a tick to a floating-point price of token1 per token0 on the
 * geometric curve: price = 1.0001^tick. For display/estimation only; on-chain
 * settlement uses fixed-point geometric math.
 */
export function tickToPrice(tick: number): number {
  return TICK_BASE ** tick;
}

/** Inverse of {@link tickToPrice}. Returns a (non-aligned) real-valued tick. */
export function priceToTick(price: number): number {
  if (price <= 0) throw new Error("price must be positive");
  return Math.log(price) / Math.log(TICK_BASE);
}

/** Default deadline: current time plus `seconds` (default 300). */
export function deadlineFromNow(seconds = 300): bigint {
  return BigInt(Math.floor(Date.now() / 1000) + seconds);
}
