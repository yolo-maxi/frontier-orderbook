# Testing & Verification

What the test suite proves, how, and the measured numbers. 135 tests total:
130 local (offline) + 2 Base-mainnet fork tests (gated behind `FORK=true`).

## Strategy

Four independent implementations of one interface, cross-checked:

1. **ReferenceBook** — eager, loops every position per fill. Trivially
   auditable transcription of the requirements; the oracle.
2. **RangeTakeProfitBook** — the lazy fill-clock design.
3. **RangeTakeProfitHook** — the same design on a real v4 PoolManager with
   real tick math.
4. **UniformFrontierBook** / **GeometricFrontierBook** — the width-O(1)
   frontier-delta design with witness-based claims (the shipped book;
   `GeometricFrontierBook` extends `UniformFrontierBook`). The original
   rolling/linear/shaped variant is archived on `archive/rolling-frontier-book`.

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

### `test/FrontierTwoSided.t.sol` — bids, two-sided structure, taker limits

Thirteen tests. Bid side (the descending mirror, token0-denominated sizes):
deposit pulls the ceil token1 value, down-sweeps pay sellers per-level
floors, makers claim exact token0; no-resurrection and epoch isolation on
price recovery; bid requote (82,155 gas) with freshness; witness checks
reject under/overstated frontiers; cancel mid-fill returns the token0/token1
mix. Market structure: up-sweeps fill only asks, down-sweeps only bids;
crossing deposits revert on both sides; the pointer cannot cross resting
liquidity for free (a no-funds account reverts trying — moving the price IS
trading), while moves inside the spread stay free. Taker protections:
`sweepWithLimits(target, maxFills, maxPay, minOut, deadline)` parks on
maxPay in both directions (resumable), reverts on minOut shortfall and
expired deadlines. Conservation: both delta ledgers sum to zero after full
settlement, zero stranded token0, wei-dust token1.

### `test/FrontierRecycle.t.sol` — internal-balance recycling (archived)

Note: internal-balance recycling was removed from the shipped book; this
suite and the surface it exercises live on `archive/rolling-frontier-book`.
Seven tests for the internal ledger: a maker who has NEVER approved token0
recycles a filled bid's earnings straight into a new ask
(`recycleBidIntoAsk`) with the wallet untouched — the zero-approval setup
proves no transferFrom can be involved; the ask->bid mirror leaves excess
earnings as withdrawable credit; shortfalls pull exactly the difference;
plain deposits spend credit first; `withdrawInternal` exits and underflows
revert; credits are fully token-backed and the book drains to dust on full
exit; recycle beats the claim+deposit round trip in gas (149,579 vs
162,509 with cheap mock tokens — the gap widens with real ERC20s and the
avoided approve).

### `test/FrontierOzempic.t.sol` — endpoint-telescoped sweeps (thin ticks, compressed settlement)

The "tick ozempic" upgrade: up-sweeps settle whole runs between ORDER
ENDPOINTS with one closed-form series + one absorption (per-boundary clock
stamps replaced by one high-water record per sweep; claims/cancels resolve
the per-position prefix against it in O(log sweeps)). Five tests: a 5% move
across 500 ACTIVE thin levels from 5 makers sweeps for 218,895 gas isolated
(per-level it was ~46k x 500 ~ 23M) with every maker's claim exact to the
wei vs brute force; sweep gas independent of tick fineness for one order
(50 vs 5,000 levels: +43k, all bitmap word-walk — growth asserted
word-bounded, never per-level); freshness + no-resurrection across
telescoped sweeps and lifecycles; maxPay parks MID-RUN at the exact
affordable thin tick via closed-form subdivision and resumes exactly.
(The archived shaped book settled 500-level shaped ladders as one
quadratic-series run, 150,396 gas, exact to the wei.)
The differential fuzz (2,000 runs) passes unchanged —
telescoped settlement is outcome-identical to per-level. Sweep budget
(`maxFills`) now counts endpoint-steps, not levels; adjacent same-size
single-level orders coalesce into one run automatically.

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

**Methodology (corrected 2026-06-10 after audit).** Numbers below this note
are from `forge test --isolate -vv`: every operation runs as its OWN
transaction, so they include intrinsic tx cost (~21k), realistic cold
storage access, and end-of-tx gas refunds — i.e. they approximate what a
wallet pays (excluding L2 data fees). Earlier per-feature numbers in this
file and in commit messages were measured intra-tx with `gasleft()` deltas:
those are correct measurements of WARM execution (valid only for bundled
multicalls) and understate standalone costs substantially — e.g. a bid
witness-claim is ~50k isolated but appeared as ~6k warm. All measured
operations now assert their outputs (real payouts, real transfers), so a
benchmark cannot silently measure a no-op. Tokens are MockERC20 (cheap
transfers); real ERC20s add roughly 10-40k per transfer. Width-equality
assertions use a +/-50 gas tolerance for calldata-byte differences. The +22k
deposit step at small widths is PROVEN to be one cold bitmap word write, not
width scaling: a width-10 deposit straddling two 256-interval words costs
the same as width-100,000 (testDepositStepIsBitmapWordsNotWidth).

### Endpoint sweeps: before/after (isolated, per-transaction, identical scenarios)

Measured by running `test/PublishBench.t.sol` under `--isolate` on this
commit and on the pre-telescoping commit (5b29538) in a git worktree:

| Dense thin-tick sweep | per-level (before) | telescoped (after) | reduction |
|---|---|---|---|
| 1 maker, 50 levels | 2,213,334 | 166,738 | 13x |
| 1 maker, 500 levels | 21,934,544 | 167,340 | **131x** |
| 1 maker, 5,000 levels | 286,766,384 (~10 blocks; unexecutable) | 209,817 | **1,367x** |
| 5 makers, 500 active levels | 21,430,170 | 214,412 | 100x |
| sparse: 2 orders, 100k-tick gap | 1,096,008 | 1,110,572 | ~same (bitmap already solved sparse) |

Thin ticks are no longer a taker cost: sweep gas is O(order endpoints
crossed + bitmap words), so fineness costs ~nothing (50 vs 5,000 levels of
one order: +43k, all bitmap word-walk). The irreducible unit is the ORDER
ENDPOINT (~10-13k marginal): a sweep crossing 50 distinct makers' separate
orders pays for 50 absorptions — that is maker-count, not tick-count.
Bid-side (down-sweep) telescoping is not yet mirrored: bids still settle
per-level (~44k/level); the ask side demonstrates the mechanism.

### Corrected headline numbers (isolated, per-transaction)

Frontier book, maker ops: deposit flat 228,913 (1 bitmap word) / 250,825
(2 words, widths 1k-100k identical); deposit bid
228,054 (10 lvls) / 249,978 (10k lvls); requote flat 104,053 (repeats cost
the same — there is NO warm steady state across transactions); requote
bid 116,505; witness-claim 65,956 any width (48,885
when the recipient token balance slot is already nonzero); witness-cancel
85,697-89,537; scan claim/cancel at width 1000: 73,434 / 84,292; canary
70,756 flat at K=2/40. (The shaped-deposit/requote and internal-recycle
numbers belonged to the archived rolling/shaped book on
`archive/rolling-frontier-book`.)

Frontier book, taker: ~46,241/level flat asks,
~43,673/level bids (20-level sweeps incl. fixed overhead); empty-gap
traversal 161,806 over 2,560 ticks / 2,513,068 over 256,000.

Bucket book (isolated): deposit ~23k/level (335,864 w10 to 11,379,496
w500); claim ~4.4k/level scanned; swap ~8-10k/level AFTER refunds (zeroing
bucket slots refunds 4,800 each, capped at 1/5 tx gas) — cheaper per level
for takers than the frontier book, whose fills write fresh clock stamps and
bitmap updates; user-count independence and canary flat as before
(202,145 / 105,371 / 109,775 / 272,258).

The historical per-feature tables below are kept for relative comparisons
(flat-vs-flat within one mode) but are intra-tx warm measurements — do not
read them as transaction costs.

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

Frontier book (`UniformFrontierBook`/`GeometricFrontierBook`, width-O(1) — the R9 "desired" property, proven):

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
