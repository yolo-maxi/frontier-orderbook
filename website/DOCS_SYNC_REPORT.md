# Docs Sync Report

Source pass date: 2026-06-24

## Source Of Truth

- Core contracts read: `prototype/src/UniformFrontierBook.sol`, `UniformMakerOps.sol`, `FrontierBookBase.sol`, `GeometricFrontierBook.sol`, `FrontierGeoBookFactory.sol`, `FrontierDeployers.sol`.
- Periphery read: `FrontierRouter`, `FrontierLens`, `FrontierMakerKit`, `FrontierPositionNFT`, `RangeLP`, `YieldRangeLP`.
- Hooks/permissions read: `IFrontierHooks`, `ExampleHooks`, `ExperimentHooks`, `PermissionRegistry`, `IPermissionRegistry`.
- Deploy script read: `prototype/script/DeployFrontier.s.sol`.
- Behavioral tests sampled: gas, hooks, fees, permissions, periphery, position NFT, mirror/mirror liquidity, geometric book, RangeLP, YieldRangeLP.

## Measured Numbers

`forge build --sizes` with the default profile completed compilation but exited nonzero because runtime size exceeds EIP-170:

| Contract | Runtime size |
| --- | ---: |
| `UniformFrontierBook` | 27,025 B |
| `GeometricFrontierBook` | 27,429 B |
| `UniformMakerOps` | 14,671 B |
| `GeometricMakerOps` | 15,055 B |
| `FrontierGeoBookFactory` | 7,828 B |
| `FrontierLens` | 14,021 B |
| `FrontierRouter` | 6,475 B |
| `FrontierPositionNFT` | 11,400 B |
| `PermissionRegistry` | 12,374 B |

`FOUNDRY_PROFILE=deploy forge build --sizes` succeeds and is the real-chain size profile:

| Contract | Runtime size |
| --- | ---: |
| `UniformFrontierBook` | 21,549 B |
| `GeometricFrontierBook` | 22,120 B |
| `GeometricMakerOps` | 11,596 B |
| `FrontierGeoBookFactory` | 5,728 B |
| `FrontierLens` | 11,440 B |
| `FrontierRouter` | 4,724 B |
| `FrontierPositionNFT` | 8,020 B |
| `PermissionRegistry` | 9,146 B |

Fee parameters from `DeployFrontier.s.sol` and `FrontierBookBase`: `MAKER_FEE_BPS` and `TAKER_FEE_BPS` default to `0`, are capped at `1,000`, and require a nonzero recipient when nonzero. `FEE_RECIPIENT` defaults to the deployer in the deploy script.

Gas rows in the website table were refreshed from `forge test --isolate -vv` runs on `FrontierGasTest`, `GasMatrixTest`, `GeoBookTest`, `PublishBenchTest`, `FrontierMirrorTest`, and `FrontierVenueTest`. TWAP hook overhead was refreshed from `HookExperimentsTest`: 31,770 gas on the first sweep, 34,550 gas steady-state.

## Page-By-Page Changelog

| Page | What was wrong | Now says | Evidence |
| --- | --- | --- | --- |
| `index.md` | Hero and prediction-market copy used `$0.001` / half-cent ticks and a stale `1,335x` compression claim. | Uses basis-point geometric ticks and current 5,000-level gas: 194,299 gas ask benchmark, 177,815 gas geometric benchmark. | `GeoTickMath`, `GeometricFrontierBook`; `PublishBenchTest`, `GeoBookTest`. |
| `roadmap.md` | Listed bids, geometric curve, NFT wrapper, and contract-size split as future work; said 156 tests and maker fills must stay fee-free. | Documents current EIP-170 default/deploy profile split, immutable per-book fees, mirror-liquidity caveats, and 206 test/invariant entrypoints. | `GeometricFrontierBook`, `FrontierPositionNFT`, `MakerTakerFees.t.sol`, `forge test --list`. |
| `brand.md` | Brand examples taught `$0.001` ticks, `1,335x`, and removed `recycle` vocabulary. | Uses basis-point ticks, current 194,299 gas receipt, and `requote` vocabulary. | `FrontierQuoter.t.sol`; no `recycleBidIntoAsk` in deploy-facing book. |
| `guide/architecture.md` | Factory/deployer split and EIP-170 wording were stale; maker-ops sharing key omitted fees; `YieldRangeLPFactory` absent. | Describes `GeometricBookDeployer` / `GeometricOpsDeployer`, measured deploy gas, deploy-profile sizes, maker-ops memoization key, `YieldRangeLPFactory`, and immutable fees. | `FrontierGeoBookFactory`, `FrontierDeployers`, `DeployFrontier.s.sol`, size builds. |
| `guide/mechanism.md` | Claimed internal balances and `recycleBidIntoAsk` still existed. | Replaces that with current mirror/mirror-liquidity accounting and per-book fee fields. | `FrontierBookBase`, `UniformFrontierBook`, `UniformMakerOps`, `FrontierRecycle.t.sol`. |
| `guide/build.md` | No code-backed drift found in this pass. | No content change. | Root `sdk`, `mcp`, `indexer`, `skill`, `docs` directories exist. |
| `guide/demo.md` | Redeploy instructions pointed at stale `deploy-devnet.sh` flow using removed `FrontierBookFactory` / `createBook`. | Points to `DeployFrontier.s.sol` with `FOUNDRY_PROFILE=deploy` and lists current required/optional env vars. | `prototype/script/DeployFrontier.s.sol`; stale shell script read but not modified. |
| `guide/gas.md` | Prose and table used old gas numbers, removed shaped/recycle rows, and old `FrontierMakerOps` name. | Table and prose use current gas logs and current `UniformMakerOps` / `GeometricMakerOps` names. | `FrontierGasTest`, `GasMatrixTest`, `PublishBenchTest`, `GeoBookTest`, `FrontierMirrorTest`. |
| `guide/hooks.md` | Used nonexistent `createBookWithHooks`, simplified hook rejection, old companion name, and approximate TWAP overhead. | Uses `createGeoBookWithHooks` / `createGeoBookWithHooksAndFees`, `HookRejected`, maker-ops companion names, and measured TWAP overhead. | `IFrontierHooks`, `FrontierBookBase`, `FrontierGeoBookFactory`, `HookExperiments.t.sol`. |
| `guide/permissions.md` | `_authOwner` snippet omitted the zero-registry owner-only branch. | Snippet now includes `if (address(permissions) == address(0)) revert NotOwner();`. | `FrontierBookBase._authOwner`. |
| `guide/pricing.md` | Claimed the devnet/current deployment used a linear placeholder curve. | Frames the linear curve as the uniform test path and states the deploy script creates geometric books. | `GeometricFrontierBook`, `BookFab`, `DeployFrontier.s.sol`. |
| `guide/topology.md` | Factory/default-book and fee-power language was stale; singleton section referenced a removed recycle-style ledger. | Describes geometric factory books, first/default router book, per-book-at-birth fees, and removes recycle wording. | `FrontierGeoBookFactory`, `FrontierRouter`, `FrontierBookBase`. |
| `experiments/yield.md` | Said Level 1 vault-native quoting capital was designed but not built and quoted an unrefreshed `~104k` requote number. | Documents shipped `YieldRangeLP` / factory behavior and tests; leaves only Level 2 as not built. | `YieldRangeLP.sol`, `YieldRangeLP.t.sol`, `Yield.t.sol`. |
| `experiments/lp.md` | No drift found in current pass. | No content change. | `RangeLP.sol`, `RangeLP.t.sol`. |
| `experiments/v4-hook.md` | No drift found in current pass. | No content change. | `RangeTakeProfitHook.sol`, `ForkBaseHook.t.sol`. |
| `experiments/partial-fills.md` | Could be read as current deploy-facing behavior. | Explicitly says it is not in current deploy-facing books. | `NOTES-partial-fills.md`; no partial-fill surface in `UniformFrontierBook`. |
| `experiments/mirror-liquidity.md` | Claimed every mirror-liquidity fill always pays 30 bps and takers always pay taker fees. | Explains 30 bps mirror fee applies only when `feeRecipient` exists, no-recipient books mirror fee-free, and taker fee applies only if configured. | `UniformFrontierBook._mirrorFee`, `FrontierMirror.t.sol`. |
| `FeatureGrid.vue` | Public feature card still advertised `$0.001` increments. | Uses production `1.0001^tick` wording and endpoint/bitmap gas scaling. | `GeometricFrontierBook`, `GasCostTable.vue`. |
| `GasCostTable.vue` | Embedded stale gas data and removed shaped/recycle rows. | Replaced with current measured rows for takers, makers, factory deployment, and mirror-liquidity pool operations. | `forge test --isolate -vv` logs listed above. |

## Verification

- `pnpm install` in `website/`: succeeded from the lockfile.
- `pnpm build` in `website/`: succeeded (`vitepress build`, build complete in 3.85s).
- `forge build --sizes` in `prototype/`: compiled successfully but exited nonzero because the default profile exceeds EIP-170 for `UniformFrontierBook` and `GeometricFrontierBook`; sizes recorded above.
- `FOUNDRY_PROFILE=deploy forge build --sizes` in `prototype/`: succeeded; deploy-profile sizes recorded above.
- `forge test --isolate -vv --match-contract "(FrontierGasTest|GasMatrixTest|GeoBookTest|PublishBenchTest|FrontierMirrorTest)"`: 36 passed, 0 failed.
- `forge test --isolate -vv --match-contract "(HooksTest|HookExperimentsTest|HookScenariosTest)"`: 25 passed, 0 failed.
- `forge test --isolate -vv --match-test testFactoryParallelMarkets`: 1 passed, 0 failed; factory create gas was 8,811,051.
- Stale-name grep excluding this report:
  `rg -n "RollingFrontierBook|FrontierBookFactory|FrontierMakerOps|createBookWithHooks|createBook\\(|depositShaped|requoteShaped|recycleBidIntoAsk|SqrtLiquidityBook" website --glob '!DOCS_SYNC_REPORT.md'`
  returned no hits.
- Hits inside this report are intentional historical changelog entries that identify removed/stale names corrected elsewhere.
