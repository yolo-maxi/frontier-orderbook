# Experiment: Sub-Tick Partial Fills (solved — coarse maker grid)

**Resolution (2026-06-11):** the parked problem below is solved by inverting
the framing. Keep the book's tick grid FINE (taker/fill granularity), and
make coarseness a *maker placement policy* enforced by a `beforeDeposit`
hook (`MakerGridHook`). A taker parking mid-interval leaves the surviving
liquidity as a frontier delta *at that fine tick* — the watermark, encoded
positionally. New liquidity into a half-consumed coarse interval is simply a
second frontier at the grid boundary below; takers consume the two cohorts
in price order, each priced separately by the same telescoped sweep. The
mixed-cohort accounting that killed the original design never arises,
because no two cohorts ever share a fractional state — remaining fractions
live in *where* each delta sits. Zero new core state; one patch (requotes
now dispatch the placement hook); nine pinning tests in
`FrontierPartialFills.t.sol`.

The original experiment record:

# Experiment: Sub-Tick Partial Fills (parked)

**Question:** can a level be partially consumed — price settling mid-tick,
makers exiting the sold fraction — without per-user work?

**Answer:** yes; built, 8 tests passing, then **deliberately reverted**.
Full design preserved in `NOTES-partial-fills.md`.

The mechanism was a per-level *watermark*: price settling 40% into a level
irreversibly sells 40% of that bucket pro-rata, recorded as one
`(offset, cohort)` pair — no new tick entries, cumulative-floor payouts
that telescope exactly (ten 1-tick partial claims sum to the full-level
amount to the wei).

The catch that made it not worth the complexity: watermarked buckets must
stay **single-cohort**. New liquidity entering a half-consumed level (by
deposit, or rolled in from below after a deep reversal) would hold a
different remaining-fraction per unit, and correct accounting then needs
per-cohort multiplicative indices with per-fill snapshots — designed,
sound, and a real audit-surface step.

The decision: **thin ticks make sub-tick precision unnecessary.** With
endpoint-telescoped sweeps, tick fineness is nearly free, so "partial
fill of a fat tick" is replaced by "full fills of very thin ticks." The
watermark design stays parked unless taker UX ever demands true
mid-level execution.
