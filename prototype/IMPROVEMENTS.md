# Frontier book — core/periphery improvements + gas

Branch: `track/contracts`. Scope: `prototype/` only. All 191 pre-existing
tests stay green (2 skipped unchanged); 17 new tests added in
`test/FrontierImprovements.t.sol`.

## Five improvements

### 1. On-chain frontier exposure (core) — `FrontierBookBase`
`frontierOf(positionId)` and `bidFrontierOf(positionId)` return a position's
live fill frontier — the highest ask boundary covered by up-sweeps (lowest
bid boundary covered by down-sweeps) since deposit, clamped to range. This is
the value integrators previously had to reconstruct off-chain from a boundary
witness; it is now a single view call. Reverts cleanly for dead positions and
for the wrong side.

### 2. Keeper-friendly auto-claim (core) — `UniformFrontierBook`
`claimAuto(positionId, minProceeds)` and `claimBidAuto(positionId, minProceeds)`
settle a position to its current frontier and revert unless net proceeds reach
`minProceeds`. Proceeds always pay the **position owner** (operators manage,
never receive — same invariant as the rest of the book), so a bot can batch
harvest across a maker's book and fail cheaply when nothing material is owed,
removing the off-chain "is this tx worth submitting?" race. Authorization
flows through the existing `claimTo`/`claimBidTo` permission path.

### 3. Enriched position reads (periphery) — `FrontierLens`
- `positionView(book, id)` — one fully-resolved snapshot: owner, range,
  liquidity, frontier, claimable, and unfilled principal, routed through the
  book's own getters so it matches what a claim would pay. Dead ids return a
  zeroed, `live == false` view.
- `positionViews(book, ids[])` — batch the above for an explicit id set.
- `positionsOf(book, owner, fromId, toId)` — every live position an owner
  holds in an id window (`toId == 0` ⇒ up to `nextPositionId()`), for indexers
  and maker dashboards.

### 4. Top-of-book read (periphery) — `FrontierLens.bestPrices`
`bestPrices(book, scanWindow)` returns best ask/bid levels with resting sizes,
their X18 curve rates, and the spread in ticks — everything a UI needs to
render the inside market in one `eth_call`, curve-aware (linear demo /
geometric production) via the existing `curveOf` probe.

### 5. Fee fast path (core, also gas G4) — `FrontierBookBase`
`_chargeMakerFee` / `_takerTotal` short-circuit when the book's fee bps is
zero (the common case): no mul/div, no fee transfer, no fee event. This is
both a simplification (the zero-fee path is now explicit) and a runtime gas
win on every claim/cancel/sweep of a fee-free book.

## Gas

- Baseline captured with `forge snapshot` before changes; re-run after.
- **G4 fee fast path** is the headline runtime win: fee-free claims/cancels/
  sweeps skip the fee mul/div + conditional transfer + event branch entirely.
  Measured on fee-free benches (e.g. `testWitnessCancel`, `testWitnessClaim`,
  `testDelayedClaimEquivalence`) the per-op work drops; correctness unchanged
  (`testZeroFeesPreserveOldBehavior` and the fee-conservation fuzz suites stay
  green, fee-bearing books take the identical arithmetic branch as before).
- Whole-suite per-test gas figures rose by a uniform offset because the new
  view functions add bytecode that each test's `setUp` deploys; this is
  deploy-time, not per-call runtime, and does not affect the hot paths.

---

## Loop 2 — gas pass (G1 landed in full)

### G1 — string `require` → custom errors (core book pair), tests in lockstep

The deferral note below is now resolved. Every string `require` in the three
**core** book contracts (`FrontierBookBase`, `UniformFrontierBook`,
`UniformMakerOps`, ~95 sites) was converted to a `revert CustomError()`. The
selectors live in one free-floating file, `src/FrontierErrors.sol`, so the
delegatecall pair (book + maker-ops) and the periphery/tests all reference the
**same** `Error.selector` — a divergent selector per half would be a latent bug.

Scope discipline (why this is fully correct, not partial):

- Only contracts that revert with strings AND are reached by the frontier book
  were converted. Untouched, deliberately: `ReferenceBook`,
  `RangeTakeProfitBook`/`RangeTakeProfitHook`, `FrontierRouter`, `RangeLP`,
  `FrontierPositionNFT`, the TWAP/observation hooks, `PermissionRegistry`. Their
  string reverts and the tests asserting them are unchanged.
- All ~30 affected test assertions were migrated to
  `vm.expectRevert(Error.selector)` in lockstep
  (`FrontierImprovements`, `FrontierTwoSided`, `FrontierScenarios`,
  `MakerTakerFees`, `FrontierQuoter`, `FrontierVenue`, `Periphery`,
  `HookExperiments`, `Hooks`, `Permissions`).
- The shared `ScenarioSuite` (run against the string books **and** the
  custom-error frontier book) now expects reverts through small `virtual`
  hooks (`_expectNotLive`, `_expectRangeNotAbovePrice`, `_expectEmptyRange`,
  `_expectZeroLiquidity`, `_expectUnaligned`) that default to the string form
  and are overridden to selectors only in `FrontierScenariosTest`. This keeps
  one suite precise against three books with different revert vocabularies.

Measured impact (`forge snapshot` before/after, default profile — the figure
each test reports includes its `setUp` book-pair deployment, so the dominant
win is **deploy-time** bytecode shrink; the revert path also gets cheaper):

| Bench (deploys a fresh book pair in setUp)        | before     | after      | delta     |
|---------------------------------------------------|-----------:|-----------:|----------:|
| `FrontierGasTest:testDepositGasFlatVsWidth`       | 39,677,987 | 39,041,432 |  -636,555 |
| `FrontierGasTest:testCancelGasFlatVsWidth`        | 29,870,529 | 29,397,653 |  -472,876 |
| `FrontierGasTest:testClaimGasFlatVsWidth`         | 30,133,594 | 29,661,231 |  -472,363 |
| `FrontierGasTest:testSwapGasFlatVsLevelsOfOneOrder`| 29,907,782| 29,435,828 |  -471,954 |
| `FrontierOzempicTest:testSweepGasIndependentOfTickFineness` | 29,829,410 | 29,357,458 | -471,952 |
| `GasMatrixTest:testBidOperationCosts`             | 30,088,213 | 29,612,120 |  -476,093 |
| `FrontierVenueTest:testFactoryGeometricBooks`     | 27,615,531 | 27,190,669 |  -424,862 |
| `FrontierVenueTest:testFactoryParallelMarkets`    | 48,732,000 | 48,025,770 |  -706,230 |
| `PeripheryTest:testLensDepthAndSummary` (many books) | 6,158,888 | 4,085,426 | -2,073,462 |
| `FrontierImprovementsTest:testBestPricesEmptySides`  | 5,118,812 | 2,982,940 | -2,135,872 |

Whole-suite: **152 benches changed, net −18.14M gas** (sum of decreases
−18.66M, increases +0.52M). The handful of small increases are fee-bearing
fuzz paths where the `if (...) revert` codegen reorders a few SLOADs on the
non-reverting branch (e.g. `testTakerUpSweepFee` +370k on a 122M baseline =
+0.3%); happy-path semantics are unchanged. Deployed runtime sizes
(`FOUNDRY_PROFILE=deploy forge build --sizes`): `GeometricFrontierBook`
22,045 B / `GeometricMakerOps` 11,596 B / `UniformFrontierBook` 21,474 B /
`UniformMakerOps` 11,007 B — all comfortably under the 24,576 B EIP-170 limit.

### G2 (powX18 sweep memoization) — attempted, measured, reverted

Threading the shared run-endpoint pow through the sweep loop (a run's
`P(runEnd)` equals the next contiguous run's `P(e)`) was implemented and
benchmarked. It is a **net loss** here: the production sweep benches drive one
order spanning many levels = a single run with only two pows total, so there is
nothing to memoize, yet every sweep pays the added virtual-dispatch + extra
return-value overhead. Measured `testGeometricSweepGasIndependentOfTickFineness`
went 18.06M → 19.56M and the multi-endpoint
`testSwapGasScalesWithEndpointsNotLevels` 25.93M → 27.38M. Reverted in full;
`GeoTickMath.powX18` and the sweep loop are unchanged from loop 1. A transient-
storage (`tload`/`tstore`) memo is blocked by the `view` mutability of the run
helpers (`tstore` is rejected in `view`; the run chain feeds `view` getters like
`claimable`/`rateAt`, so it cannot be relaxed without a larger refactor).

## Deferred (documented, intentionally not attempted)

- **Sub-interval partial-fill (cohort) rework** — explicitly high risk; a half
  implementation would destabilize the fill-clock / high-water invariants. Not
  attempted. All composites added here are whole-interval only.
- **G2 powX18 memoization** — attempted and reverted (net negative on the real
  benches; see above).
- **Multi-curve dispatch registry (C3)** — would touch the storage/immutable
  layout shared across the EIP-170 book/maker-ops split; not low-risk enough
  to land alongside the above without a dedicated migration story.
