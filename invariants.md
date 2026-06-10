# Invariants

## Core accounting invariants

### I1. No resurrection

Once a user's sell liquidity is consumed over a tick interval, that user's liquidity for that interval must never become active again due only to price reversal.

### I2. Epoch isolation

Deposits after a fill must not be entitled to proceeds from that earlier fill.

### I3. No double fill

A position cannot earn from the same consumed interval twice unless it explicitly deposited fresh liquidity for a later lifecycle/epoch.

### I4. Lazy claim equivalence

A user claiming once at the end must receive the same result as claiming immediately after every fill, modulo deterministic rounding/dust policy.

### I5. Pro-rata correctness

For a consumed segment/epoch, proceeds must be distributed proportional to active eligible liquidity in that segment at the time of consumption.

### I6. Aggregate active liquidity correctness

Active liquidity for any tick interval equals the sum of all unconsumed orders currently live in that interval.

### I7. Reversal idempotence

Moving price backward through consumed intervals must not:

- change existing claimable proceeds
- re-enable old sell liquidity
- reverse prior sale proceeds back into principal

### I8. New deposit freshness

A new user depositing into `[lowerTick, upperTick]` joins the current lifecycle for each relevant interval and does not inherit closed lifecycle proceeds.

### I9. Conservation

For each position, deposited sell token must equal:

- unfilled active principal
- plus consumed principal represented by generated proceeds
- plus cancelled/returned principal
- plus protocol fees/rounding/dust according to policy

### I10. No overclaim

Total claimed buy token for any consumed interval/lifecycle must never exceed proceeds generated for that interval/lifecycle.

### I11. Claim order independence

The order in which users claim must not affect other users' entitlements, except for deterministic dust policy.

### I12. Boundary determinism

Tick inclusivity/exclusivity must be explicitly defined and stable.

Exact-tick scenarios must not produce ambiguous fills.

### I13. Cancel correctness

Cancelling after partial fill returns filled proceeds and unfilled principal, then removes all future eligibility.

### I14. Directional symmetry

If both directions are supported, token1-to-token0 downward orders must obey equivalent invariants to token0-to-token1 upward orders.

## Scalability invariants

### S1. Swaps do not loop users

Swap execution must not iterate over users or user positions.

### S2. Deposits do not loop users

A new deposit must not iterate over existing users.

### S3. Claims do not loop other users

A user claim must not iterate over other users.

### S4. Range-width complexity is explicit

If a design claims O(1) deposit or claim with respect to ticks-in-range, tests must prove gas does not materially increase as range width increases.

### S5. Initialized-tick scaling is allowed

Swap gas may scale with crossed initialized ticks, matching the Uniswap model, but not with number of users represented behind those ticks.
