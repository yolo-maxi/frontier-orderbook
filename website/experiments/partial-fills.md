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
