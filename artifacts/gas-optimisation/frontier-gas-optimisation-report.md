# Frontier Maker/Bid Gas Optimisation Report

## Summary

Recommendation: merge this branch. Loop 2 meets the strict `<180000` isolated `depositBid` target while preserving the external `positions(id)` getter shape and all maker/bid settlement behavior covered by the full test suite.

Target status: met.

- Loop 1 gas-report `depositBid` min: `211704`
- Loop 2 gas-report `depositBid` min: `177992`
- Loop 2 console `bid deposit (10 levels)`: `178500`

## Results

Loop 1 result, from `after.md`:

- `bid deposit (10 levels)`: `212212`
- `bid deposit (10,000 levels)`: `234136`
- gas-report `depositBid`: min `211704`, avg `219012`, median `211704`, max `233628`

Loop 2 result:

- `bid deposit (10 levels)`: `178500`
- `bid deposit (10,000 levels)`: `200725`
- gas-report `depositBid`: min `177992`, avg `185400`, median `177992`, max `200217`

Loop 2 deltas:

- `bid deposit (10 levels)`: `212212 -> 178500`, delta `-33712`
- `bid deposit (10,000 levels)`: `234136 -> 200725`, delta `-33411`
- gas-report `depositBid` min: `211704 -> 177992`, delta `-33712`
- gas-report `depositBid` avg: `219012 -> 185400`, delta `-33612`
- gas-report `depositBid` max: `233628 -> 200217`, delta `-33411`
- `claimBidTo`: `48623 -> 46490`, delta `-2133`
- `cancelBidWithWitness`: `60105 -> 57752`, delta `-2353`

Total from pre-loop-1 baseline:

- gas-report `depositBid` min: `229546 -> 177992`, delta `-51554`
- `bid deposit (10 levels)`: `230054 -> 178500`, delta `-51554`

## What Changed

- Repacked `Position` so flat bid positions write two slots instead of three.
- Moved ask-only `slope` to `_positionSlope[positionId]`; bids and flat asks avoid that write.
- Kept the public `positions(uint256)` getter signature by replacing the public mapping getter with an explicit function returning the same tuple.
- Added `_storePosition`, a direct two-word store for fresh deposits, matching Solidity's packed struct layout and avoiding extra compiler-generated packing overhead.
- Packed `nextPositionId` as internal `uint64 _nextPositionId` and kept `nextPositionId()` returning `uint256`.
- Coalesced fresh bid bitmap updates when both endpoints are in the same bitmap word.
- Removed the hot `_maxBoundary` write from bid deposits; `bidLiquidity` derives the view scan ceiling from `_currentTick`.
- Used unchecked arithmetic in `_uniformSpanValue` where the tick/int/uint128 domains bound overflow, while preserving the existing positive-rate check.
- Kept deposit hook behavior intact with a hookless call-site guard.
- Inlined the bid token1 credit-first pull and used a low-level bool-returning ERC20 call that preserves `"transfer in failed"` on failure.

## Storage Breakdown

Before loop 2, a fresh bid wrote:

- 3 position slots: owner/range, liquidity/slope, clock/cursor/flags.
- 2 bid endpoint slots: `bidDelta[upper - tickSpacing]`, `bidDelta[lower - tickSpacing]`.
- 1 or 2 bitmap word writes, depending on whether endpoints share a 256-interval word.
- `_maxBoundary`.
- `nextPositionId`.
- Token balance writes in `token1.transferFrom`.

After loop 2, a fresh bid writes:

- 2 position slots: `owner/lower/upper/claimedUpper/live/isBid` and `liquidity/depositClock`.
- 2 bid endpoint slots.
- 1 coalesced bitmap word for the 10-level same-word case, or 2 bitmap words for wide/straddling cases.
- `_nextPositionId`.
- Token balance writes only when internal token1 credit is insufficient.

The unavoidable storage floor for a wallet-funded fresh bid is now dominated by two position slots, two endpoint slots, one bitmap word in the same-word case, the id update, the internal-credit check, and the ERC20 transfer.

## Token Transfer And Credit

Wallet-funded final `depositBid`:

- Console `bid deposit (10 levels)`: `178500`
- Gas-report `depositBid` min: `177992`

Credit-funded contained benchmark using existing APIs:

- Flow: `deposit` ask, fill, `claimInternal`, set token1 approval to zero, then `depositBid`.
- Console `bid deposit from internal credit (10 levels)`: `143821`
- Gas-report `depositBid` min: `143436`

Measured implication: the wallet `transferFrom` path plus zero-credit handling accounts for about `34.7k` gas versus a fully credit-funded bid deposit in this mock-token setup (`178500 - 143821 = 34679`). The existing credit-first model is already the route to sub-150k bid deposits for makers recycling proceeds.

## Endpoint And Bitmap Notes

Two endpoint SSTOREs remain fundamental to the current descending frontier model: the `+L` frontier endpoint and the `-L` lower sentinel are both needed so sweeps know where the aggregate bid run starts and stops.

The safe same-word optimization is limited to bitmap maintenance. It removes the redundant second bitmap word update for fresh endpoints in the same 256-interval word. It cannot remove the second endpoint delta without changing sweep/no-resurrection accounting.

Wide deposits remain about `22.2k` above same-word deposits because they touch a second cold bitmap word:

- `bid deposit (10 levels)`: `178500`
- `bid deposit (10,000 levels)`: `200725`
- delta: `22225`

## Uniswap Comparison Caveat

Uniswap-style paths can be cheaper for the specific "mint a position" surface because LP state is designed around compact tick/position accounting and does not model this book's per-maker frontier cursor, claim freshness, two-sided credit recycling, and standalone ERC20 custody in the same way.

The apples-to-apples gap is narrower when comparing required semantics. Frontier deposits pay for explicit maker ownership, claim/cancel cursors, endpoint roll accounting, bitmap sweep discovery, and token funding or internal credit. A Uniswap LP mint also has tick initialization and token transfer costs, but it does not need a per-order no-resurrection frontier cursor for later witness claim/cancel in this venue model.

## Attempted And Rejected

- Separate public bid-position storage was not needed for this loop; the explicit getter plus side slope mapping captured the safe part without breaking external getter shape.
- Removing either bid endpoint was rejected as unsafe: sweep correctness and no-resurrection require both the active frontier endpoint and the lower sentinel.
- Skipping internal-credit lookup for wallet deposits was rejected because existing deposit paths intentionally spend credit first.
- Dropping the bid `transferFrom` failure reason was tested and reverted; the final code preserves `"transfer in failed"`.
- A temp benchmark test for internal-credit deposits was used for measurement only and removed before commit.

## Next Opportunities

- High impact, medium risk: make credit-first/singleton credit a first-class maker workflow across books. Expected impact is about `35k` gas for deposits that can avoid ERC20 transferFrom, but it expands accounting and authorization scope.
- Medium impact, medium risk: split bid and ask storage more aggressively, including side-specific structs and possibly side-specific getter adapters. The safe slot reduction is already captured; further gains likely require API/storage compatibility decisions.
- Medium impact, low risk: steer market makers toward recycle/requote flows. Current logs: `recycleBidIntoAsk` `126241` versus `claimBid + deposit` `145057`; `requoteBid` logs around `81918`.
- Medium impact, high risk: redesign endpoint/index accounting to reduce bitmap or endpoint writes. This touches sweep correctness and should be a dedicated architecture branch.
- Low impact, low risk: extend hookless pre-checking to more callback paths after benchmarking code-size tradeoffs.

## Verification

Commands run on the final code:

- `cd prototype && forge test --match-path 'test/GasMatrix.t.sol' --match-test 'testBidOperationCosts' --isolate -vv --gas-report` passed.
- `cd prototype && forge test --match-path 'test/*Gas*.t.sol' --isolate -vv --gas-report` passed, 19 tests.
- `cd prototype && forge test --match-contract 'FrontierTwoSidedTest|FrontierRecycleTest|PeripheryTest|PositionNFTTest|RangeLPTest|YieldRangeLPTest' -vv` passed, 41 tests.
- `cd prototype && forge test` passed, 193 passed, 0 failed, 2 fork tests skipped.
