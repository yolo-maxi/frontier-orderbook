# Note: Watermark Partial Fills (designed, built, reverted 2026-06-10)

Status: parked. The frontier book ships with whole-interval fill granularity
("thin ticks"). This note preserves the sub-interval partial-fill design that
was fully implemented and tested (8 passing tests), then reverted as too
complex for the current stage. Recoverable from this note + git history of
the branch session if needed.

## The idea (Fran's)

Use coarse tick spacing (boundaries at 1000, 2000, 3000…) but let price
settle ANYWHERE inside an interval. A settle at 1500 inside [1000, 2000)
irreversibly sells 50% of the frontier bucket pro-rata — it's a book, the
taker keeps the tokens, so nothing needs to be reversible. Makers can exit
the sold 50% immediately, and no new tick entries are ever created.

## How it was implemented

- Per interval: `PartialState { uint24 offset; uint128 cohort; }` — `offset`
  = ticks already sold from the interval's lower edge in its current
  lifecycle (the watermark), `cohort` = the liquidity present when the
  watermark started. One scalar pair, no new boundaries.
- Consumption within a lifecycle is **monotone from the watermark up**:
  price retreating and re-entering below the watermark sells nothing again
  (those asks are spent); advancing past it sells only the new sub-span.
- Sweep: the final, partially-entered interval sells
  `(newOffset - oldOffset)/spacing` of the cohort at the interval's rate;
  completion sells the remainder, stamps the boundary clock, rolls the
  deltas, resets the watermark.
- Positions gained a `claimedOffset` cursor next to `claimedUpper`.
  `claimPartial(id)` paid the sold fraction mid-lifecycle in O(1). Payouts
  used **cumulative-floor telescoping** — `paid(offNow) - paid(offPrev)` —
  so any sequence of partial claims plus the completion claim summed to
  EXACTLY the full-interval rate (ten 1-tick partials == one claim, to the
  wei; test-verified).
- Cancel mid-partial returned the sold proceeds + unsold token0 mix and
  decremented the cohort; the watermark auto-reset when its cohort emptied.

## Why it was reverted: the single-cohort constraint

The watermark model silently assumes every unit in a partially-consumed
bucket has the SAME remaining fraction. That breaks the moment new units
join a watermarked interval, two ways:

1. **Fresh deposit** into a watermarked interval (price retreated below it).
2. **Roll-in**: units from the interval below completing a second time
   (after a deep retreat + fresh deposits below) roll into the watermarked
   interval.

Mixed cohorts have different remaining-token0-per-unit, so pro-rata partial
fills, completion payouts, and the span closed-form all misprice — fixing it
properly needs per-interval multiplicative indices (a `remainingIndex` R and
cumulative `proceedsPerUnit` P), per-fill-event append-only snapshots for
roll-in cohorts, and witness-supplied cohort clocks (safe because a stale
witness can only self-underpay). That machinery was designed (sound, all
O(1) amortized) but is a real complexity and audit-surface step.

The shipped implementation instead ENFORCED single-cohort lifecycles:
deposits into a watermarked interval reverted ("interval mid-lifecycle"),
and sweeps that would roll units into a live watermark cohort reverted
("watermark conflict"), with the watermark auto-resetting once its cohort
exited (no deadlock; both unblock paths tested). Correct, but the two revert
edges are exactly the kind of surprising venue behavior we don't want yet.

## Decision

Thin ticks instead: with width-O(1) deposits and requotes, fine spacing is
nearly free for makers; the cost of thin spacing lands only on the taker
sweep path (~50k gas per non-empty level crossed). Whole-interval
granularity keeps every invariant trivial.

Revisit triggers: if taker UX demands true mid-level execution (min fill =
level depth becomes a real complaint), or if a continuous-price AMM-style
front-end is wanted — then implement the index-math extension above rather
than the restricted watermark.

## Test inventory that existed at revert (for reconstruction)

testHalfFillAtMidInterval, testWatermarkIsOneWay,
testPartialThenCompletionPaysExactlyFullRate, testCancelMidPartialReturnsMix,
testDepositIntoWatermarkedIntervalReverts, testRollIntoLiveWatermarkReverts,
testPartialConservation (wei-dust), testTinyPartialSteps (telescoping).
