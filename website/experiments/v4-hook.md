# The Uniswap v4 Lineage

Frontier began as a requirements package for **take-profit range orders**
on Uniswap v4 (the original spec — requirements, invariants, accounting
scenarios, adversarial test plan — is preserved at the repo root). Two
complete implementations from that phase remain in the tree and in the
test suite:

## The fill-clock bucket book + real v4 hook

Per-tick buckets fully consumed on crossing (no resurrection by
construction), a global fill clock for lifecycle isolation, real pool
liquidity owned by the hook, `afterSwap` burning crossed buckets. The
hook runs the **identical scenario suite** as every other implementation,
on a real PoolManager with real sqrt-price math — and was validated
end-to-end on a **Base mainnet fork**: a fee-0 WETH/USDC pool on the
deployed PoolManager, fills driven through the deployed **Universal Router
2.1.1** (V4_SWAP + Permit2), claims exact to the wei at realistic negative
ticks.

Hard-won v4 facts encoded in those tests:

- **noSelfCall**: v4 silently skips hook callbacks for hook-initiated
  actions — a hook can never observe its own swaps.
- **Settlement ordering**: `afterSwap` runs before the swapper settles, so
  fill proceeds must be minted as ERC-6909 claims and redeemed at
  user-claim time.
- The deployed UR 2.1.1 swap-params struct has six fields
  (incl. `minHopPriceX36`) — older 5-field encodings revert opaquely.

## Why Frontier left the AMM

The width-O(1) frontier representation cannot back a vanilla
real-liquidity hook: only the frontier level would be materialized in the
pool, so one swap sweeping several levels would glide through
unmaterialized liquidity. Inside v4 the choices were per-level costs or a
custom-curve (return-delta) hook — at which point a standalone venue is
simpler and strictly more capable. The bucket book remains the right
design *if* vanilla-v4 compatibility is ever the priority again.
