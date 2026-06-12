# Frontier Maker/Bid Gas Optimisation Report

## Summary

Recommendation: merge now. The branch keeps the public API and settlement behavior unchanged, reduces isolated `depositBid` by `17,842` gas in both measured widths, and passes the full Forge suite.

What changed:

- Boundary tracking for the O(width) view helpers now uses sentinel values instead of `_minBoundarySet` / `_maxBoundarySet` booleans.
- Deposit hook dispatch now checks the hook address and permission flags before building callback calldata, so hookless deposits avoid unnecessary ABI encoding.

What did not change:

- Public maker/bid APIs are unchanged.
- Position ownership, claim, cancel, requote, recycle, internal credit, sweep, and hook semantics are unchanged.
- Endpoint delta accounting and bitmap semantics are unchanged.
- Token transfer behavior is unchanged.

## Baseline

Required baseline command:

```sh
cd prototype
forge test --match-path 'test/GasMatrix.t.sol' --match-test 'testBidOperationCosts' --isolate -vv --gas-report
```

Baseline numbers:

- `bid deposit (10 levels)`: `230054`
- `bid deposit (10,000 levels)`: `251978`
- `bid witness-claim`: `53656`
- `bid witness-cancel`: `65200`
- gas-report `depositBid`: min `229546`, avg `236854`, median `229546`, max `251470`

## After

Required after command:

```sh
cd prototype
forge test --match-path 'test/GasMatrix.t.sol' --match-test 'testBidOperationCosts' --isolate -vv --gas-report
```

After numbers:

- `bid deposit (10 levels)`: `212212`
- `bid deposit (10,000 levels)`: `234136`
- `bid witness-claim`: `53645`
- `bid witness-cancel`: `65200`
- gas-report `depositBid`: min `211704`, avg `219012`, median `211704`, max `233628`

Gas deltas:

- `bid deposit (10 levels)`: `230054 -> 212212`, delta `-17842`
- `bid deposit (10,000 levels)`: `251978 -> 234136`, delta `-17842`
- `bid witness-claim`: `53656 -> 53645`, delta `-11`
- `bid witness-cancel`: `65200 -> 65200`, delta `0`
- gas-report `depositBid` min: `229546 -> 211704`, delta `-17842`
- gas-report `depositBid` avg: `236854 -> 219012`, delta `-17842`
- gas-report `depositBid` max: `251470 -> 233628`, delta `-17842`
- `RollingFrontierBook` deployment cost: `6507746 -> 6535075`, delta `+27329`
- `RollingFrontierBook` deployment size: `30805 -> 30863`, delta `+58`
- `FrontierMakerOps` deployment cost: `3460766 -> 3462467`, delta `+1701`
- `FrontierMakerOps` deployment size: `16383 -> 16309`, delta `-74`

## Why DepositBid Was About 230k

The isolated standalone transaction pays for several cold first-touch costs:

- ERC20 transfer path: `_pull1` first checks `internalBalance1[payer]`, then calls `token1.transferFrom`. With the mock token and max allowance, the allowance is read but not decremented; maker balance is updated and the book's token1 balance is usually a zero-to-nonzero write on the first deposit.
- Position storage: `positions[positionId]` occupies three storage slots. A fresh bid writes owner/range, liquidity/slope, and clock/cursor/live/bid flags. `slope` is zero for bids, but the shared `Position` layout still needs the slot.
- Position id: `nextPositionId++` is a nonzero-to-nonzero storage update.
- Endpoint deltas: `_addBid` writes two `bidDelta` mapping entries, normally cold zero-to-nonzero writes at `upper - tickSpacing` and `lower - tickSpacing`.
- Bitmap maintenance: each endpoint transition from zero updates `bidBitmap`. If both endpoints are in one bitmap word, the second bit set is a warm nonzero-to-nonzero word update; if they are in different words, the second word is another cold zero-to-nonzero write. This is why the 10,000-level case remains about `21.9k` above the 10-level case.
- Boundary tracking: before this branch, first bid deposits also initialized `_maxBoundary` and `_maxBoundarySet` for the `bidLiquidity` view. That was not needed by settlement.
- Hookless deposits still paid some ABI encoding overhead before `_callHook` could discover that hooks were disabled.

Bid-vs-ask asymmetries:

- Bids are token1-funded and token0-denominated. The hot path computes `_uniformSpanValue` and pulls token1.
- Flat asks pull token0 principal; shaped asks may also write slope endpoints. Bids do not support shapes today, but they share the same `Position` struct as shaped asks.
- Bid endpoints are mirrored around descending fills: `+L` at `upper - tickSpacing`, `-L` at `lower - tickSpacing`.

## Tradeoffs Accepted

- Sentinel boundary values move a small amount of deployment cost into construction to avoid first-deposit boundary-set writes. This is a good tradeoff for a long-lived book: first ask and first bid deposits both benefit, and future boundary extensions avoid redundant boolean writes.
- Deposit hook helpers duplicate a small amount of hook dispatch logic. This adds `58` bytes to `RollingFrontierBook`, but keeps hook behavior unchanged and removes hookless calldata encoding from every deposit.

## Tradeoffs Rejected

- Bitmap coalescing for same-word bid endpoints was tested and reverted. It saved only `692` gas on same-word bid deposits, did nothing for wide deposits, and regressed cancel/sweep codegen slightly.
- Splitting bid positions into a bid-specific storage layout could plausibly save one fresh position slot, but it would change storage/API expectations around `positions` and increase audit surface.
- Adding a no-credit wallet-only deposit path could skip the internal-credit SLOAD, but it would add API surface and caller choice complexity for a small standalone saving.
- Moving token transfers or endpoint writes across each other does not remove the dominant storage writes and risks changing revert/callback ordering.
- Simplifying endpoint/bitmap accounting is higher impact but directly touches no-resurrection and sweep correctness; not appropriate for this low-risk branch.

## Further Opportunities

- High impact, high risk: split bid and ask position storage, or pack bid-only positions separately. Expected saving is up to one cold fresh position slot on bid deposits, but the public getter/storage model and maker ops would need careful redesign.
- High impact, high risk: singleton/global credit architecture across books. This can amortize token transfers and approvals for active makers, but adds accounting, authorization, and solvency complexity.
- Medium impact, low risk: maker workflows should prefer `requoteBid` over fresh cancel/deposit where possible. Current targeted test logs `bid requote gas: 85324`, much cheaper than a fresh standalone deposit.
- Medium impact, low risk: use existing internal credit/recycle flows for maker lifecycle operations. Current test logs `claimBid + deposit (round trip): 164728` versus `recycleBidIntoAsk: 150629`.
- Medium impact, medium risk: extend the pre-checked hook dispatch pattern to claim/cancel/sweep callbacks. This is likely a small hookless saving, but should be benchmarked against code size and hooked-path clarity.
- Low impact, low risk: document multicall economics for makers. Batching saves per-transaction intrinsic and repeated cold account/token costs, but it does not remove the fundamental position and endpoint writes.

## Verification

Commands run:

- `cd prototype && forge test --match-path 'test/GasMatrix.t.sol' --match-test 'testBidOperationCosts' --isolate -vv --gas-report` passed.
- `cd prototype && forge test --match-path 'test/*Gas*.t.sol' --isolate -vv --gas-report` passed, 19 tests.
- `cd prototype && forge test --match-contract 'HooksTest|FrontierTwoSidedTest|FrontierRecycleTest|RangeLPTest|PeripheryTest' -vv` passed, 40 tests.
- `cd prototype && forge test` passed, 193 passed, 0 failed, 2 fork tests skipped.
