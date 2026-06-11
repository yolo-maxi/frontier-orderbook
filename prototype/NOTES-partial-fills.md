# Note: Watermark Partial Fills

## UPDATE 2026-06-11: solved by a COARSE MAKER GRID over a fine book

Fran's reframe: maker placement is coarse (boundaries at 1000, 2000, 3000…);
taker execution is fine (the frontier can rest at 1234). New liquidity into
a partially-consumed coarse interval is fine because cohorts are SEPARATE
FRONTIERS — one maker effectively holds [1234, 5000), a fresh one holds
[1000, 5000), and takers consume them in price order.

This is sound, and the shipped endpoint-delta machinery ALREADY implements
it. The realization:

- A "watermark inside an interval" IS a survivor `frontierDelta` materialized
  at a fine tick — exactly what `_parkUp`/`_parkDown` already write when a
  sweep exhausts its budget mid-run. Nothing in the delta maps, the sweep
  telescoping, the high-water stack, or the claim/cancel span math requires
  endpoint keys to be coarse.
- The reverted design's fatal flaw — mixed cohorts sharing one fractional
  watermark per bucket — dissolves because the frontier representation
  encodes each cohort's remaining fraction POSITIONALLY (where its delta
  sits), not as a per-bucket fraction. Two cohorts in one coarse interval
  are just two deltas at two ticks; a sweep prices each run separately and
  absorbs them in order. No `remainingIndex`, no `proceedsPerUnit`, no
  per-fill snapshots, no revert edges.
- Therefore: run the book with FINE `tickSpacing` (= taker/fill granularity,
  e.g. 1) and enforce COARSE placement (`makerSpacing`, e.g. 1000) as
  POLICY via a `beforeDeposit` hook — `src/hooks/examples/MakerGridHook.sol`.
  Zero core state changes. One core patch: `FrontierMakerOps.requoteShaped/`
  `requoteBid` now dispatch the beforeDeposit hook so requotes cannot bypass
  placement policy.

Invariants (all test-pinned in `test/FrontierPartialFills.t.sol`):

1. Taker execution NEVER fails or quantizes to a coarse interval: `maxPay`
   subdivides a fat interval to the exact affordable fine tick and parks
   there resumably (product invariant).
2. Sold prefixes stay sold: retreat + re-entry below a cohort's frontier
   sells nothing again (its delta no longer exists below the frontier).
3. Partial claims telescope: part-floors sum to the full-span floor within
   1 wei, never over.
4. Cancel mid-partial returns sold proceeds (token1) + unsold tail
   principal (token0) exactly, and removes the cohort's two deltas.
5. Cohorts fill strictly in price order; depth above the highest frontier
   aggregates normally (everyone whole there).

Costs / accepted tradeoffs:

- Bitmap density: sweeps read one tick-bitmap word per 256 FINE ticks of
  empty gap (~2.1k gas cold each). With fine=1 vs coarse=1000 that is up to
  1000x more word-reads across wide dead zones. Real books quote near the
  price so gaps are short; if it ever bites, add a second-level bitmap
  (word-of-words covers 65,536 fine ticks) — contained, standard.
- Placement near the watermark: while price rests at 1234, fresh makers can
  enter at 2000+ only; the remainder [1234, 2000) belongs to existing
  cohorts until price retreats below 1000. This is policy in the hook, not
  machinery — a later policy could also allow "exactly at the current
  frontier" placements without touching the core.
- Min order size: level size >= 1 applies per FINE tick (width-in-fine-ticks
  wei minimum; negligible even for 6-decimal tokens).
- Pricing semantics sharpen: each fine tick sells at its own rate, instead
  of a whole coarse level selling at its lower-edge rate. Quoters must use
  the fine curve.
- O(width) convenience views (`activeLiquidity`) scan fine ticks now;
  already documented as off-chain-only.

The note below preserves the ORIGINAL sub-interval watermark design and why
it was reverted; it remains the record of why per-bucket fractional
watermarks are the wrong representation.

---

Status of the design below: superseded (see update above). The frontier book
ships with whole-interval fill granularity
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
