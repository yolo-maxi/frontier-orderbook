# Solidity / Foundry Test Plan

## Reference model

Before testing a production implementation, create a simple reference model that prioritizes correctness over gas.

The reference model may use arrays/maps and may scan intervals/users internally. It exists only to define expected results.

Production candidate implementations should be fuzzed against the reference model.

## Functional tests

### testBasicPartialFill

Steps:

1. Bob deposits sell token0 order `[1,100]`.
2. Alice buys through `[1,2]`.
3. Assert Bob has claimable token1 proceeds for `[1,2]`.
4. Assert Bob has no active sell liquidity below tick `2`.
5. Assert Bob remains active over `[2,100]`.

### testReversalDoesNotResurrect

Steps:

1. Start from `testBasicPartialFill` state.
2. Move price back to `0`.
3. Assert Bob's claimable proceeds are unchanged.
4. Assert Bob has no active sell liquidity over `[1,2]`.
5. Assert no reverse conversion of proceeds occurred.

### testBobAliceCarolEpochIsolation

Steps:

1. Bob deposits `[1,100]`.
2. Alice consumes `[1,2]`.
3. Price returns to `0`.
4. Carol deposits `[1,100]`.
5. Assert Carol cannot claim earlier proceeds.
6. Assert active liquidity:
   - `[1,2]`: Carol only
   - `[2,100]`: Bob + Carol
7. Dave consumes `[1,2]` again.
8. Assert Carol receives second `[1,2]` proceeds.
9. Assert Bob does not receive proceeds from second `[1,2]` fill.
10. Consume `[2,3]`.
11. Assert Bob and Carol share `[2,3]` pro-rata.

### testSameLifecycleProRata

Steps:

1. Bob deposits liquidity `L`.
2. Eve deposits liquidity `3L` into same range before fill.
3. Consume `[1,2]`.
4. Assert Eve receives 3x Bob's proceeds.

### testOverlappingRanges

Steps:

1. Bob deposits `[1,100]`.
2. Eve deposits `[2,50]`.
3. Consume `[1,3]`.
4. Assert `[1,2]` belongs only to Bob.
5. Assert `[2,3]` is shared Bob/Eve pro-rata.

### testDelayedClaimEquivalence

Steps:

1. Bob deposits.
2. Several fills and reversals happen.
3. Bob claims once at the end.
4. Compare against reference model where Bob claims after every fill.
5. Assert balances match modulo deterministic rounding policy.

### testCancelAfterPartialFill

Steps:

1. Bob deposits `[1,100]`.
2. `[1,2]` fills.
3. Bob cancels.
4. Assert Bob receives proceeds from `[1,2]`.
5. Assert Bob receives unfilled principal from `[2,100]`.
6. Assert Bob receives no future proceeds.

### testMultipleLifecyclesSameInterval

Steps:

1. Bob deposits `[1,2]`; interval fills.
2. Carol deposits `[1,2]`; interval fills.
3. Dan deposits `[1,2]`; interval fills.
4. Assert each user only claims proceeds from the lifecycle they joined.

### testBoundaryRules

Cases:

- deposit exactly at current tick
- deposit exactly at lower tick
- deposit exactly at upper tick
- swap lands exactly on boundary tick
- swap stops one tick before boundary
- zero-width or invalid ranges revert

Expected inclusivity/exclusivity must be defined before implementation.

### testRoundingDust

Cases:

- very small liquidity
- many users with non-divisible shares
- repeated partial fills

Assertions:

- total claimed proceeds never exceed generated proceeds
- dust handling is deterministic
- no user can extract dust by claim ordering

## Gas and complexity tests

### testDepositGasIndependentOfUserCount

Setup:

- seed `N = 1, 10, 100, 1000` users into the same range
- measure gas for one additional deposit

Expected:

- gas should be effectively constant with respect to existing user count

### testSwapGasIndependentOfUserCount

Setup:

- seed `N = 1, 10, 100, 1000` users into same range
- perform the same swap through `[1,2]`

Expected:

- gas should not grow with `N`

### testClaimGasIndependentOfOtherUsers

Setup:

- seed `N = 1, 10, 100, 1000` users
- fill one interval
- measure Bob's claim

Expected:

- gas should not grow with other users

### testDepositGasVsRangeWidth

Setup:

- deposit ranges `[1,10]`, `[1,100]`, `[1,1000]`, `[1,100000]`

Expected:

- if O(1) range deposit is claimed, gas must remain materially flat
- otherwise document exact scaling behavior

### testClaimGasVsRangeWidth

Setup:

- Bob deposits increasingly wide ranges
- only `[1,2]` fills
- Bob claims

Expected:

- if O(1) claim is claimed, gas must remain materially flat
- otherwise document exact scaling behavior

### testSwapGasScalesOnlyWithInitializedTicks

Setup:

- hold user count constant
- vary crossed initialized intervals/ticks: `1, 10, 100`

Expected:

- gas may grow with initialized ticks crossed
- gas must not grow with users represented behind those ticks

### testHistoricalFragmentationCanary

Setup:

- create many historical fills/lifecycles over sub-intervals
- add a broad-range position after fragmentation
- later claim

Expected:

- if gas grows with number of historical epochs/segments, the implementation is not truly O(1)
- this test should expose hidden segment-scan designs

## Fuzz properties

Fuzz over:

- deposit order
- overlapping ranges
- reversals
- partial fills
- cancellations
- delayed claims
- repeated deposits into previously consumed intervals

Compare production candidate against reference model for:

- active liquidity by interval
- claimable proceeds by user
- unfilled principal by user
- total conservation
- no overclaim
