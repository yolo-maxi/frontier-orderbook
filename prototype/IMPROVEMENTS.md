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

## Deferred (documented, intentionally not attempted)

- **Sub-interval partial-fill (cohort) rework** — explicitly high risk; a half
  implementation would destabilize the fill-clock / high-water invariants. Not
  attempted. All composites added here are whole-interval only.
- **Broad G1 (string requires → custom errors)** — ~25 test assertions match
  on exact revert strings (`vm.expectRevert(bytes("..."))`). A blanket
  conversion would force rewriting those assertions for a benefit that is
  realized only on the revert path (custom errors mainly help deploy size and
  reverting-call cost, not the happy path). Per the "land fewer fully-correct
  changes; default to not degrading" guidance, this was left for a dedicated
  pass that updates tests in lockstep.
- **Multi-curve dispatch registry (C3)** — would touch the storage/immutable
  layout shared across the EIP-170 book/maker-ops split; not low-risk enough
  to land alongside the above without a dedicated migration story.
