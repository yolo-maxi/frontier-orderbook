/** Maximum maker or taker fee, in basis points, enforced by the contracts. */
export const MAX_FEE_BPS = 1000;

/** Denominator for fee bps math (100% = 10_000 bps). */
export const FEE_BPS_DENOMINATOR = 10_000n;

/** The geometric book price curve base: price(tick) = 1.0001^tick. */
export const TICK_BASE = 1.0001;

/**
 * Selectors for the position-management functions on GeometricFrontierBook,
 * useful for scoped grants through the PermissionRegistry. These are the
 * 4-byte function selectors (keccak of the canonical signature).
 */
export const BOOK_SELECTORS = {
  claim: "0x379607f5",
  claimTo: "0xac3b68e3",
  cancel: "0x40e58ee5",
  cancelWithWitness: "0x260cfd8f",
  claimBid: "0x21113057",
  claimBidTo: "0xabccb5ef",
  cancelBid: "0x9703ef35",
  cancelBidWithWitness: "0x56e172a2",
  requote: "0xbcf82d31",
  requoteBid: "0x84616e58",
  transferPosition: "0x55bd513f",
} as const;
