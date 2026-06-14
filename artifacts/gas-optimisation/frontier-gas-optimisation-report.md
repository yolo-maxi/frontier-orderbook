# Frontier Maker/Bid Gas Optimisation Report

## Summary

Recommendation: merge this branch, then start a dedicated architecture branch for any attempt to push wallet-funded fresh `depositBid` materially below `178k`.

Loop 3 did not find a safe production-code change that meaningfully reduces the wallet-funded isolated bid deposit. The remaining wallet cost is mostly structural: ERC20 funding plus the position, endpoint, bitmap, and id writes required by the current public position and sweep model.

Loop 3 did add a permanent benchmark proving the practical maker-default route: recycle proceeds into internal credit, then deposit from credit. That route is already sub-150k in the gas report.

## Results

Loop 1 result, from `after.md`:

- `bid deposit (10 levels)`: `212212`
- `bid deposit (10,000 levels)`: `234136`
- gas-report `depositBid`: min `211704`, avg `219012`, median `211704`, max `233628`

Loop 2 result:

- `bid deposit (10 levels)`: `178500`
- `bid deposit (10,000 levels)`: `200725`
- gas-report `depositBid`: min `177992`, avg `185400`, median `177992`, max `200217`

Loop 3 wallet-funded result:

- `bid deposit (10 levels)`: `178500`
- `bid deposit (10,000 levels)`: `200725`
- isolated wallet gas-report `depositBid`: min `177992`, avg `185400`, median `177992`, max `200217`

Loop 3 internal-credit result:

- Permanent benchmark console `bid deposit from internal credit (10 levels)`: `148444`
- Permanent benchmark gas-report `depositBid`: min `143436`, avg `143436`, median `143436`, max `143436`
- Full gas suite gas-report `depositBid`: min `143436`, avg `175525`, median `177992`, max `200217`, calls `5`

## Deltas

Loop 1 -> loop 2:

- `bid deposit (10 levels)`: `212212 -> 178500`, delta `-33712`
- `bid deposit (10,000 levels)`: `234136 -> 200725`, delta `-33411`
- gas-report `depositBid` min: `211704 -> 177992`, delta `-33712`
- gas-report `depositBid` avg: `219012 -> 185400`, delta `-33612`
- gas-report `depositBid` max: `233628 -> 200217`, delta `-33411`

Loop 2 -> loop 3 wallet-funded:

- `bid deposit (10 levels)`: `178500 -> 178500`, delta `0`
- `bid deposit (10,000 levels)`: `200725 -> 200725`, delta `0`
- isolated wallet gas-report `depositBid` min: `177992 -> 177992`, delta `0`
- isolated wallet gas-report `depositBid` avg: `185400 -> 185400`, delta `0`

Wallet-funded -> internal-credit-funded in loop 3:

- Console: `178500 -> 148444`, delta `-30056`
- Gas-report min: `177992 -> 143436`, delta `-34556`

Total from pre-loop-1 baseline:

- gas-report `depositBid` min: `229546 -> 177992`, wallet-funded delta `-51554`
- console `bid deposit (10 levels)`: `230054 -> 178500`, wallet-funded delta `-51554`

## What Changed

Loop 1 and loop 2 production changes:

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

Loop 3 change:

- Added `GasMatrixTest.testCreditFundedBidDepositCost`.
- The benchmark creates token1 credit through a real ask deposit, fill, and `claimInternal`, zeros token1 approval, then posts a same-width bid from internal credit.
- No production contract code changed in loop 3.

## Storage Breakdown

Current fresh wallet-funded bid writes:

- 2 position slots:
  - slot 0: `owner`, `lower`, `upper`, `claimedUpper`, `live`, `isBid`
  - slot 1: `liquidity`, `depositClock`
- 2 bid endpoint slots:
  - `bidDelta[upper - tickSpacing]`
  - `bidDelta[lower - tickSpacing]`
- 1 coalesced bitmap word for the 10-level same-word case, or 2 bitmap words for wide/straddling cases.
- `_nextPositionId`.
- Token balance/allowance state through token1 `transferFrom` when internal token1 credit is insufficient.

Storage pass 2 conclusion:

- `live` and `isBid` are already packed into slot 0. Re-encoding them does not remove a fresh SSTORE while preserving `positions(id)` compatibility.
- `claimedUpper` is already packed into slot 0. It could be implied only for never-claimed fresh positions, but that would not remove a slot and would complicate getter and claim/cancel semantics.
- `depositClock` is packed with `liquidity` in slot 1. It is required to test fill freshness after later sweeps.
- The two endpoint writes are fundamental to the current descending frontier model. Removing either the upper frontier endpoint or lower sentinel would change sweep/no-resurrection accounting.

## Funding And Maker Route

Wallet-funded `depositBid` still checks internal credit first, then performs token1 `transferFrom` for the shortfall. Skipping the credit lookup would break the public "credit first" behavior. Removing the token pull would break ERC20 funding compatibility.

The practical maker-default route is already present:

- `claimInternal(positionId)` credits ask proceeds as token1 inside the book.
- `depositBid(...)` spends that token1 credit first.
- `recycleAskIntoBid(askId, lower, upper, liquidity)` does both in one call.
- The mirror route `claimBidInternal` / `recycleBidIntoAsk` does the same for token0 into asks.

Evidence:

- Fully credit-funded `depositBid` gas-report min: `143436`.
- Fully credit-funded `depositBid` console log: `148444`.
- Wallet-funded isolated `depositBid` gas-report min: `177992`.
- `recycleBidIntoAsk`: `126241`.
- `claimBid + deposit` round trip: `145057`.
- `requoteBid`: `81918`.

## Endpoint And Bitmap Notes

Same-word bid bitmap handling is already optimized for fresh endpoints: if both endpoints are in one bitmap word, loop 2 updates that word once.

Wide bids remain more expensive because they touch a second bitmap word:

- `bid deposit (10 levels)`: `178500`
- `bid deposit (10,000 levels)`: `200725`
- delta: `22225`

The second endpoint delta cannot be removed safely in this model. The upper endpoint materializes the current bid frontier; the lower sentinel stops the descending run. Sweep, no-resurrection, claim, cancel, and bid liquidity semantics depend on both.

## Attempted And Rejected

- Further flag packing for `live` / `isBid`: rejected because both flags already live in a written position word.
- Implied `claimedUpper` for fresh bids: rejected because it saves no storage slot and creates getter/claim complexity.
- Removing one bid endpoint: rejected as a sweep correctness and no-resurrection risk.
- Removing the same-word bitmap write: rejected because sweep discovery requires the endpoint word to be visible.
- Skipping the internal-credit lookup for wallet deposits: rejected because credit-first deposits are public behavior.
- Adding a separate wallet-only deposit route: rejected for this branch because it creates API surface and encourages the less efficient maker path for only a narrow gas win.
- Deeper singleton/global credit accounting, separate bid map, ERC6909 accounting, or dropping `positions(id)` compatibility: deferred to a dedicated architecture branch.

## Hard Cost Floor

The current wallet-funded fresh bid floor is dominated by:

- Position ownership and settlement cursor: 2 SSTOREs.
- Frontier accounting: 2 endpoint SSTOREs.
- Sweep discovery: 1 same-word bitmap SSTORE, or 2 for wide/straddling bids.
- Id allocation: `_nextPositionId` nonzero-to-nonzero update.
- Funding: internal credit SLOAD plus token1 `transferFrom` call and token state writes.
- Logs and validation: range checks, amount math, `Deposit` event, and hook guards.

That combination explains why wallet-funded isolated `depositBid` did not safely move toward `160000` without an API/storage architecture change.

## Recommendation

Merge this branch with the loop 3 benchmark. Do not keep chasing tiny wallet-funded savings in this branch.

For the next branch, make the architecture question explicit:

- Keep the current API and push makers toward `claimInternal`, `recycleAskIntoBid`, `recycleBidIntoAsk`, and `requoteBid`.
- Or start a dedicated breaking-change branch for separate bid storage, singleton/global credits, ERC6909-style internal accounting, and possibly a new position getter shape.

## Verification

Commands run on the loop 3 code:

- `cd prototype && forge test --match-path 'test/GasMatrix.t.sol' --match-test 'testBidOperationCosts' --isolate -vv --gas-report` passed, 1 test.
- `cd prototype && forge test --match-path 'test/GasMatrix.t.sol' --match-test 'testCreditFundedBidDepositCost' --isolate -vv --gas-report` passed, 1 test.
- `cd prototype && forge test --match-path 'test/*Gas*.t.sol' --isolate -vv --gas-report` passed, 20 tests.
- `cd prototype && forge test --match-contract 'FrontierTwoSidedTest|FrontierRecycleTest|PeripheryTest|PositionNFTTest|RangeLPTest|YieldRangeLPTest' -vv` passed, 41 tests.
- `cd prototype && forge test` passed, 194 passed, 0 failed, 2 fork tests skipped.
