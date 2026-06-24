# Copy-Liquidity Geometric Zap

## Finding

The geometric shadow zap already used the curve-aware quote path. No router or book contract fix was required.

`FrontierRouter._prepareZap` chooses a rebalance budget through `_quoteBuyShadowed` / `_quoteSellShadowed`; those call `_quoteBuyGross` / `_quoteSellGross`, which route to `FrontierLens.quoteBuy` / `FrontierLens.quoteSell`. The lens detects geometric books with `geoD()` and uses the geometric `GeoTickMath` span math, so the rebalance preview is not hard-coded to uniform-curve prices.

`GeometricFrontierBook` is still accepted by the existing `UniformFrontierBook` router signatures because it inherits `UniformFrontierBook`. No signature changes were needed.

## Changes

- Refactored `FrontierZapTest` into a shared `FrontierZapBaseTest`.
- Kept the existing uniform suite as `FrontierZapTest`.
- Added `FrontierZapGeometricTest`, which deploys all books through `FrontierGeoBookFactory.createGeoBookWithFees`.
- The geometric suite inherits the full zap unit/fuzz/fee/multi-actor coverage:
  - balanced zap
  - quote-heavy zap
  - outcome-heavy zap
  - guard paths
  - empty first deposit
  - 1-wei and sequential deposits
  - max-uint preview guard
  - taker-fee zaps
  - preview-vs-actual fuzz
  - taker-fee preview-vs-actual fuzz
  - multi-actor copy-liquidity simulation with sweeps and full withdrawal drain

## Gates

Final command results from `prototype/`:

- `forge build`: passed. Compiler completed successfully; existing forge-lint warnings remain.
- `forge test`: passed, `271 passed; 0 failed; 2 skipped`.
- `forge test --match-contract FrontierZapGeometricTest -vv`: passed, `13 passed; 0 failed`.
- `forge test --match-test testFuzz_PreviewMatchesActual --fuzz-runs 10000 -vv`: passed on both books.
  - `FrontierZapTest`: `runs: 10000`, mean gas `1,933,729`.
  - `FrontierZapGeometricTest`: `runs: 10000`, mean gas `2,109,686`.
- `forge build --sizes`: passed.
- `FOUNDRY_PROFILE=deploy forge build --sizes`: passed.

## Size Gate

Runtime size limit: 24,576 bytes.

| Profile | Contract | Runtime Size | Runtime Margin |
| --- | --- | ---: | ---: |
| default | `UniformFrontierBook` | 21,608 B | 2,968 B |
| default | `GeometricFrontierBook` | 22,179 B | 2,397 B |
| deploy | `UniformFrontierBook` | 21,608 B | 2,968 B |
| deploy | `GeometricFrontierBook` | 22,179 B | 2,397 B |

## Geometric Zap Gas

From `forge test --match-contract FrontierZapGeometricTest --gas-report`:

| Function | Min | Avg | Median | Max | Calls |
| --- | ---: | ---: | ---: | ---: | ---: |
| `FrontierRouter.previewZapDepositShadow` | 991 | 706,181 | 619,759 | 899,801 | 524 |
| `FrontierRouter.zapDepositShadow` | 37,497 | 1,008,907 | 937,809 | 1,210,392 | 526 |

Selected geometric suite test gas:

| Test | Gas |
| --- | ---: |
| `testBalancedZapMatchesPreviewAndRawDeposit` | 388,416 |
| `testQuoteHeavyZapRebalancesAndDeposits` | 2,616,419 |
| `testOutcomeHeavyZapRebalancesAndDeposits` | 2,027,333 |
| `testMultiActorCopyLiquiditySimulation` | 3,517,307 |
| `testTakerFeeZapsMatchPreviewAndConserveBothDirections` | 12,120,022 |

## Blockers

None.
