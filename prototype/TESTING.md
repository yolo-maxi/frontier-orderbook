# Testing & Verification

What the test suite proves, how, and the measured numbers. 102 tests total:
100 local (offline) + 2 Base-mainnet fork tests (gated behind `FORK=true`).

## Strategy

Four independent implementations of one interface, cross-checked:

1. **ReferenceBook** — eager, loops every position per fill. Trivially
   auditable transcription of the requirements; the oracle.
2. **RangeTakeProfitBook** — the lazy fill-clock design.
3. **RangeTakeProfitHook** — the same design on a real v4 PoolManager with
   real tick math.
4. **RollingFrontierBook** — the width-O(1) frontier-delta design with
   witness-based claims.

The spec scenario suite (`ScenarioSuite`) is abstract and runs against ALL
FOUR via inheritance — so the oracle itself is pinned to the spec, and the
hook is held to the identical behavioral contract as the standalone book.
Expected amounts go through two virtual helpers (`amt0`/`amt1`): linear curve
for the standalone books, `SqrtPriceMath` for the hook.

## Suites

### `test/Scenarios.t.sol` — spec scenarios (13 × 4 implementations, + 2 prod-only rounding tests)

Direct transcriptions of `../accounting-scenarios.md` and the functional
tests in `../test-plan.md`: basic partial fill (A), reversal/no-resurrection
(A), Bob/Alice/Carol epoch isolation incl. second fill and pro-rata [2,3]
(B), overlapping ranges (C), 3L-vs-L pro-rata (D), cancel after partial fill
(E), three lifecycles in one interval, delayed-claim equivalence, and five
boundary tests (deposit at/below price, empty/inverted/zero ranges,
misaligned spacing, swap landing exactly on a boundary, swap stopping one
tick short). Prod-only: `testRoundingDust`, `testRoundingTinyLiquidity`
(floor policy, dust retention, claim-order independence).

### `test/Differential.t.sol` — randomized differential fuzz

Drives an identical 40-action random sequence (deposit / move / claim /
cancel, interleaved) through the production book and the reference book,
asserting after every action (spot checks) and after full settlement:
identical per-call outputs, identical user balances, identical per-interval
aggregate liquidity, zero retained principal, bounded one-way dust.
256 runs by default; 2,000 runs clean
(`FOUNDRY_FUZZ_RUNS=2000 forge test --match-test testFuzz_Differential`).

### `test/Gas.t.sol` — complexity claims, measured

Eight tests implementing the gas section of `../test-plan.md`: deposit /
swap / claim gas vs user count (asserted flat within 5%, measured
bit-identical), deposit / claim gas vs range width (documented linear per
S4), swap gas vs crossed intervals with constant users (S5), the historical
fragmentation canary, and the wide-position-vs-many-singles comparison.
Numbers below.

### `test/HookScenarios.t.sol` — the scenarios on a real PoolManager

The same 13-scenario suite inherited against the hook — fills happen via
actual pool swaps (through `MarketSwapper`), amounts via `SqrtPriceMath` —
plus a swap-gas-vs-users test on the real swap path.

### `test/FrontierScenarios.t.sol` / `FrontierDifferential.t.sol` / `FrontierGas.t.sol`

The same 13-scenario suite inherited against the frontier book, plus seven
witness-path tests (exact span payouts, incremental underclaiming, stale
lifecycle witness rejected, non-maximal and overstated cancel witnesses
rejected, full-consumption self-cancellation, staggered-range roll
accumulation). The differential fuzz mirrors the bucket-book one with the
documented dust-policy tolerance: token0 flows must match the reference
EXACTLY; token1 payouts must be >= the reference and within bounded wei
(span-floor vs interval-floors), with book residuals proving no overclaim.
2,000 runs clean, including a global delta-conservation invariant
(`sum(frontierDelta) == 0`) asserted after every action. Gas tests prove
deposit / witness-claim / witness-cancel flat in width (10 vs 100,000 ticks)
and the canary/user-count properties.

### `test/FrontierVenue.t.sol` — standalone-venue properties

Sparse books: a sweep across a 100k-tick empty gap with two fills costs
1,045,045 gas (word-bounded via the tick bitmap; per-interval iteration
would be ~210M — bricked); gap-scaling test shows ~20x gas for 100x the
ticks. Bounded `sweep(target, maxFills)` parks at the first unfilled
interval and resumes correctly mid-roll. Pointer policy: pinning the
pointer high through empty space is defeated by bundling a free retreat
with the deposit; a deep third-party retreat provably changes no
entitlements and resurrects nothing. Factory test runs three parallel
books (spacings 1/10/60) on one pair with full isolation; book deployment
is ~2.4M gas.

### `test/FrontierQuoter.t.sol` — the market-maker view

Ten tests on quote-update economics and correctness: `requote` (O(1)
in-place move of an unfilled order) costs 77,460 gas cold / 71,736 warm
(oscillating quotes), beats cancel+deposit (155,286) 2x, moves NO tokens
when size is unchanged and settles only the difference on resizes.
Re-pricing a 100-level ladder costs exactly what re-pricing a 10,000-level
ladder costs (101,492 — width-O(1) carries over). Correctness: requote
refreshes the clock (abandoned levels earn nothing — freshness),
partially-filled orders can't requote (settle-then-replace fallback
tested), requote into/below the price reverts, delta conservation holds
across resizing requotes. A 40-update drifting-market session averages
71,802 gas per requote.

### `test/FrontierShape.t.sol` — shaped (linear-ladder) orders

Six tests for the second-order-delta shape upgrade: a 10..1 decaying ladder
deposits the exact triangular principal, shows the right per-level aggregate
sizes, fills with the taker receiving exactly the shaped sizes, and claims
match brute-force per-level sums computed in the test; shaped cancel
returns the exact tail with value AND slope ledgers fully conserved; a
mixed book (decaying + rising + uniform, overlapping) aggregates and pays
each maker exactly; shaped deposit (255,316) and requote (151,330) are
bit-identical at widths 100 and 10,000; re-shaping on requote settles only
the size difference; the level-size >= 1 floor is enforced (protects the
bitmap-driven sweep).

### `test/ForkBaseHook.t.sol` — Base mainnet fork (block 47,138,448)

Fresh fee-0 WETH/USDC pool with the hook on the **deployed** PoolManager;
orders in real WETH; fills via the **deployed** Universal Router 2.1.1
(V4_SWAP + Permit2); ticks ≈ −198,000 (negative-tick coverage). One
end-to-end test (ladder → router fill → reversal → Carol epoch isolation →
second fill → exact claims → cancel refund) plus a deposit-below-price
revert test.

```sh
forge test                                                  # 77 local tests, fork skipped
FORK=true forge test --match-contract ForkBaseHookTest -vv  # fork tests
```

## Measured results

Scalability (standalone book, spacing 1; gas is bit-identical, not approximately flat):

| Claim | N = 1 | N = 10 | N = 100 |
|---|---|---|---|
| deposit gas vs existing users (S2) | 79,695 | 79,695 | 79,695 |
| swap gas vs users behind ticks (S1) | 106,632 | 106,632 | 106,632 |
| claim gas vs other users (S3) | 78,622 | 78,622 | 78,622 |

| Claim | result |
|---|---|
| fragmentation canary: claim gas after K=2 vs K=40 historical lifecycles | 182,323 both — claims never scan history |
| hook swap gas, 1 vs 25 users behind crossed ticks (real pool) | 180,526 both |
| swap gas vs crossed intervals 1 / 10 / 50 (allowed by S5) | 81,074 / 312,239 / 1,339,639 |

Rolling-frontier book (width-O(1) — the R9 "desired" property, proven):

| Operation | width 10 | width 1,000 | width 100,000 |
|---|---|---|---|
| deposit | 139,932 | 139,932 | 139,932 |
| witness claim (`claimTo`) | 28,350 | 28,350 | 28,350 |
| witness cancel | 34,445 | 34,445 | 34,445 |

Frontier swap: ~50k gas per crossed interval (roll + bitmap maintenance vs
the bucket book's ~25k); flat for 1 vs 100 users; canary flat. Deposit has
a one-time +22k step when the range endpoints span two bitmap words;
within the multi-word regime gas is bit-identical (width 1,000 vs
100,000).

Width scaling (documented per S4 — linear by design, the accepted compromise):

| width (intervals) | 10 | 100 | 500 |
|---|---|---|---|
| deposit gas | 308,405 | 2,389,115 | 11,636,715 |
| claim gas (1 fill) | 83,323 | 380,323 | 1,700,323 |

≈ 23k gas/interval deposit, ≈ 3.3k/interval claim scan, ≈ 20k per interval
that actually pays out. One wide [10,110) position vs 100 single-interval
positions over the same span: deposit 2,389,461 vs 7,914,500 (3.3×), claim
2,528,526 vs 3,199,700.

Fork test realism check: 0.397793 WETH laddered over 4 × 10-tick intervals;
sweeping 2 intervals cost the router swapper 502.472350 USDC (≈ $2,520/WETH
implied); Bob claimed 502.472348 USDC (2 wei floor-rounding dust retained by
the hook — no-overclaim policy with real tokens); cancel returned 0.198797
WETH for the unfilled half.

## Spec traceability

| Spec item | Where proven |
|---|---|
| I1 no resurrection | testReversalDoesNotResurrect (×4 impls), fork step 3 |
| I2 epoch isolation | testBobAliceCarolEpochIsolation, testMultipleLifecyclesSameInterval, fork step 4 |
| I3 no double fill | same + double-claim-pays-zero asserts |
| I4 lazy claim equivalence | testDelayedClaimEquivalence + fuzz (random claim timing) |
| I5 pro-rata correctness | testSameLifecycleProRata, scenario B [2,3] split |
| I6 aggregate liquidity | activeLiquidity asserts throughout + fuzz spot/final checks |
| I7 reversal idempotence | testReversalDoesNotResurrect |
| I8 new-deposit freshness | Carol tests (B), fork step 4 |
| I9 conservation | fuzz full-settlement balance equality, zero retained principal |
| I10 no overclaim | testRoundingDust, fuzz dust bound, fork 2-wei dust |
| I11 claim-order independence | testRoundingDust (per-position deterministic amounts) |
| I12 boundary determinism | five testBoundary_* tests (×4 impls) |
| I13 cancel correctness | testCancelAfterPartialFill, fork step 6 |
| I14 directional symmetry | NOT COVERED — only sell-token0 built (optional per R2) |
| S1 swaps don't loop users | testSwapGasIndependentOfUserCount + hook variant |
| S2 deposits don't loop users | testDepositGasIndependentOfUserCount |
| S3 claims don't loop users | testClaimGasIndependentOfOtherUsers |
| S4 width complexity explicit | testDeposit/ClaimGasVsRangeWidth (documented linear) |
| S5 initialized-tick scaling | testSwapGasScalesOnlyWithInitializedTicks |
| fragmentation canary | testHistoricalFragmentationCanary |

Known coverage gaps: I14 (direction mirror not built); the differential
fuzz does not include the hook (scenario parity is its current evidence);
fee≠0 pools are out of scope by design; the frontier book has no real-AMM
venue test (by design it cannot be a vanilla v4 hook — its venue is a
vault/custom pool or custom-curve hook, not yet built).
