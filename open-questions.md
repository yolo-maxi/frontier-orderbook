# Open Questions and Feasibility Risks

## Q1. Can true O(1) arbitrary range accounting exist?

Uniswap fee accounting works because fees are additive and LP principal remains reversible.

This mechanism is harder because a fill both:

1. creates proceeds, and
2. destroys future eligibility for the consumed part of the range.

A single `feeGrowthInsideLast`-style snapshot may not be enough to represent which sub-intervals of a user's range have already been consumed.

## Q2. Is a pure Uniswap-style `feeGrowthInside` approach insufficient?

Likely yes, for full arbitrary range orders.

Counterexample:

1. Bob deposits `[1,100]`.
2. `[1,2]` fills.
3. Price returns to `0`.
4. Carol deposits `[1,100]`.
5. `[1,2]` fills again.

Bob must not receive the second `[1,2]` fill, even though his original range includes `[1,2]`.

Therefore the system needs to know that Bob's `[1,2]` eligibility was consumed before Carol entered.

This is more than simple fee growth.

## Q3. What data structure captures consumed eligibility?

Candidate approaches:

- per-tick buckets with lifecycles/epochs
- range positions decomposed into bucket shares
- interval tree / segment tree over initialized order ticks
- directional traversal epochs compressed into cumulative counters
- custom AMM accounting that explicitly tracks one-way consumption

Tradeoff to evaluate:

- simplicity and correctness vs O(1) deposit/claim

## Q4. Is a hook lifecycle powerful enough?

A v4 hook may be able to observe swaps and update accounting, but it may be awkward to remove/neutralize consumed aggregate liquidity at exactly the required moment.

Need to test whether the hook can safely support:

- one-way liquidity consumption
- lazy proceeds accounting
- reversal-safe behavior
- no per-user swap work

If not, use a vault/periphery or custom AMM.

## Q5. What should be considered acceptable scaling?

Possible acceptable compromise:

- swaps scale with crossed initialized order ticks
- deposits/claims scale with number of order segments a user explicitly creates
- no operation scales with number of other users

This may be viable even if arbitrary continuous ranges cannot be O(1).

## Q6. Tick boundary semantics

Must define:

- whether `[lower, upper]` is inclusive/exclusive
- what happens if current price is exactly at lower or upper
- how exact tick landings are treated
- whether zero-width ranges are valid

## Q7. Dust and rounding policy

Must define:

- where rounding dust goes
- whether dust remains claimable by last claimant, protocol, or bucket
- how to prevent claim-order extraction

## Q8. Product requirement: forced user claim

Current requirement: users claim their own trade after execution.

This supports lazy settlement and avoids per-user work during swaps.

Need to decide whether third-party batch claiming is allowed and whether batchers receive fees.
