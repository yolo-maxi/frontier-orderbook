# Claim-Time Maker Age Rebates

This experiment adds maker fees with claim-time age rebates to reward passive
liquidity that actually rests at a price/range.

## Model

Each position stores a coarse `restingEpoch`:

```solidity
uint32(block.timestamp / EPOCH_SECONDS)
```

`EPOCH_SECONDS` is one hour. A `uint32` hour epoch lasts roughly 490,000
years, and the coarse granularity intentionally avoids pretending that
second-level age precision matters for anti-MEV incentives.

On claim or cancel of filled proceeds:

```text
grossProceeds = claim amount before fee
baseMakerFee = grossProceeds * makerFeeBps / 10_000
rebateBps = curve(currentEpoch - restingEpoch)
feeAfterRebate = baseMakerFee * (10_000 - rebateBps) / 10_000
maker receives grossProceeds - feeAfterRebate
fee recipient receives feeAfterRebate
```

Default deploy paths keep `makerFeeBps == 0`, so existing fee-free behavior is
preserved unless a book is created with explicit maker-fee config or its fee
admin enables fees.

## Rebate Curve

The first curve is deliberately chunky:

| Resting age | Rebate on maker fee |
| --- | --- |
| `0` epochs | 0% |
| `>= 1` epoch | 25% |
| `>= 4` epochs | 50% |
| `>= 24` epochs | 100% |

The curve applies at claim time, not fill time.

## Reset Rules

- Deposit starts the age clock for the new position.
- Requote, resize, or move range resets `restingEpoch` because the passive
  liquidity is no longer resting at the original price/range.
- Internal claim does not reset age. Claiming proceeds into the book ledger is
  settlement, not a change to the quote.
- Transfer preserves age. The price/range did not change, and wrappers or
  periphery can still restrict transfers if a market wants anti-rental policy.
- Cancel/withdraw retires the position; unclaimed filled proceeds are fee-netted
  the same way as a claim, while unfilled principal/refunds are not charged.

## Why Claim-Time Age

Claim-time age is the smallest mechanism that keeps the existing O(1) fill
accounting intact. Fill-time age buckets would require the sweep path to record
age-specific proceeds or bucket every fill by maker cohort, which works against
the current endpoint-telescoped design.

The tradeoff is precision: a maker that was old at claim time but fresh at fill
time receives the older rebate. For this experimental branch, that is acceptable
because the goal is a simple sticky-liquidity incentive without per-fill maker
records.

## Anti-MEV Rationale

Very fresh liquidity pays the full maker fee, so same-epoch quotes get little
benefit from briefly joining before a sweep and immediately claiming. Durable
passive liquidity earns progressively larger fee relief, up to a full maker-fee
rebate after a long rest.

## Limitations And Future Work

- The age signal is claim-time age, not fill-time age.
- The curve is fixed in code for now; governance or constructor-level curve
  config would be a later product decision.
- `claimable`/`bidClaimable` continue to report gross proceeds. Net proceeds
  depend on claim-time age and fee config.
- Future taker fees, referrer routing, or protocol fee splits should route from
  the same fee recipient/config surface or replace it with a shared fee router.
- If fill-time age buckets become necessary, the likely design is to add coarse
  age cohorts to sweep accounting while preserving endpoint aggregation where
  possible.
