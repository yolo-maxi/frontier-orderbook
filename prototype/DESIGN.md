# Prototype Design: Fill-Clock Range Take-Profit Book

> Historical design record. The rolling/linear/shaped book described here
> was the original prototype and is now archived on the
> `archive/rolling-frontier-book` branch. The shipped product is the
> geometric/uniform path: `GeometricFrontierBook` (extends
> `UniformFrontierBook`), created through `FrontierGeoBookFactory`. The
> conceptual narrative below is preserved as-is.

Status: working prototype — standalone book + real v4 hook + width-O(1)
rolling-frontier book, 79 tests passing incl. Base mainnet fork via the
deployed Universal Router
Date: 2026-06-10

This is the "why" document. See `IMPLEMENTATION.md` for contract-level
details and `TESTING.md` for the verification evidence and measured numbers.

## Mechanism in one paragraph

A sell range `[lower, upper)` is decomposed into tick-spacing intervals, each
an aggregate bucket. When price fully crosses an interval upward, the **entire
bucket** converts to token1 and its liquidity resets to zero — consumed
liquidity physically ceases to exist, so reversal cannot resurrect it (I1, I7
hold by construction, not by bookkeeping). Eligibility is tracked with a
single global **fill clock**: every fill stamps the interval with
`lastFillClock = ++fillClock`; a position stores only the scalar
`depositClock`. An interval has been consumed for a position iff
`lastFillClock > depositClock`. A lazily-written per-(position, interval)
`claimed` flag makes payment once-only.

## The two observations that make it simple

1. **Full-bucket consumption collapses epochs to a clock comparison.**
   Because a fill consumes *all* liquidity in a bucket, a position can be paid
   by at most one fill per interval: the first one after its deposit. So
   "which lifecycle/epoch am I in?" reduces to a single integer comparison —
   no per-epoch share ledger, no lifecycle ids. This is why the fragmentation
   canary passes: claims read `lastFillClock` (current state only) and never
   scan history.

2. **Per-liquidity proceeds are a pure function of the interval.**
   Converting liquidity `L` across a fixed price segment `[√P_a, √P_b]` yields
   exactly `L·(√P_b − √P_a)` of token1 — the same in every lifecycle. So no
   per-fill proceeds snapshot is needed either; the claim computes proceeds
   from `(interval, L)` directly. **This survives the move to real
   sqrt-price math** with one caveat: it requires that swap fees are NOT
   credited to order liquidity (see "v4 mapping" below). If fees were
   credited, per-fill proceeds would differ across epochs and a per-fill
   `proceedsPerLiquidity` record would be required — a modest extension, not
   a redesign.

## Boundary semantics (resolves Q6, I12)

- An interval is `[t, t+spacing)`, keyed by its lower tick `t`.
- An interval **fills** when the tick moves from below to **≥ its upper
  boundary** within an upward move. Landing exactly on a boundary fills the
  interval below it, not the one above it.
- A partially-entered interval (price inside it) has not filled and **remains
  reversible**. Consumption granularity is one interval. This is the one
  deliberate compromise vs. a fully continuous reading of R2; the scenario
  docs only exercise whole-interval fills, and sub-interval one-way locking
  would require settling the active interval at its max-reached price on
  every reversal — possible, but it reintroduces path-dependent state.
- Deposits require `lower > currentTick`: the whole range must be strictly
  above the interval containing the price. Depositing at the current tick
  reverts. Zero-width and misaligned ranges revert.

## Dust policy (resolves Q7)

Every payout is `floor(L · rate(interval))` computed per position. The bucket
collects `floor(totalL · rate)` at fill time, and `Σ floor(L_k·r) ≤
floor(ΣL_k·r)`, so overclaim is impossible (I10) and payouts are independent
of claim order (I11). Dust accretes to the contract. Deterministic, not
extractable by ordering games.

## Requirements coverage

| Requirement | Status |
|---|---|
| R2 one-way range orders | ✅ sell token0 upward; downward direction is a mirror image (not built in prototype; R2 marks it optional) |
| R3 lazy proceeds | ✅ claims read immutable facts; claim timing provably irrelevant (testDelayedClaimEquivalence) |
| R4 no per-user swap work | ✅ swap touches one bucket per crossed interval, gas bit-identical for N=1 vs N=100 users |
| R5 no resurrection | ✅ by construction (bucket zeroed at fill) |
| R6 deposit freshness | ✅ clock comparison; Carol scenario passes |
| R7 partial fills | ✅ per-interval granularity |
| R8 cancellation | ✅ claim + principal return + permanent retirement |
| R9 required complexity | ✅ all three user-count independences hold exactly |
| R9 desired (width-O(1)) | ✅ ACHIEVED by `RollingFrontierBook` (deposit/claim/cancel O(1); standalone venue). The vanilla-v4-hook variant remains O(width) — venue trade-off below |

Measured (spacing=1): deposit ≈ 23k gas per interval, claim ≈ 3.3k gas per
interval scanned, swap ≈ 25k gas per crossed non-empty interval. A 50-tick
order costs ~1.2M gas to place on L1 — fine on an L2/Base, unpleasant on
mainnet. Wider tick spacing divides all of this directly.

## Width-O(1): the original impossibility argument, and its correction (Q1/Q2/Q3)

> **CORRECTION (2026-06-10).** The argument below is wrong for the actual
> position semantics, and the conclusion is superseded: width-O(1) deposit,
> claim, and cancel ARE attainable. The flaw: the dominance-sum framing
> answers an *arbitrary rectangle* query, but a valid position is not
> arbitrary — it is born with `lower > currentTick`, so for price to fill
> any higher interval of its range it must first cross every lower interval
> of that range *after the deposit*. A position's personal filled region is
> therefore always a contiguous prefix `[lower, frontier)`, even when the
> GLOBAL fill set fragments (in the 50→80→60→70→20→30 example, a position
> above 50 sees only the `[50,80]` prefix of its own range; the `[20,30]`
> leg is below its range entirely). The 2-D dominance problem collapses to a
> 1-D frontier per position. See "The rolling-frontier design" below —
> implemented in `src/RollingFrontierBook.sol` and passing the full suite.
> Credit: external review (ChatGPT) spotted the loophole.

The original argument, kept for the record — note it is only valid for
range queries with arbitrary deposit-time/range combinations, which the
mechanism never actually performs:

- A claim must answer: *"which intervals in `[a,b)` have filled at least once
  since my deposit time `t`, and what do they sum to?"* — i.e. a **dominance
  sum** over pairs `(interval, lastFillTime)` with `interval ∈ [a,b)` and
  `lastFillTime > t`.
- The set of intervals filled since `t` is the union of `[legMin, legMax]`
  spans, one per upward leg of the price path since `t`. These spans are
  **not contiguous** (e.g. path 50→80→60→70→20→30 since deposit fills
  `[20,30] ∪ [50,80]` but not `(30,50)`). Fragment count grows with the
  number of price reversals — exactly what testHistoricalFragmentationCanary
  is designed to expose.
- Answering dominance sums in O(log) per query requires a persistent /
  versioned range structure (merge-sort tree, persistent segment tree over
  initialized ticks). Possible in theory, ~O(log²) queries, heavy constants
  and audit surface; not worth it for a prototype and probably not for
  production either.

## The rolling-frontier design (width-O(1), `src/RollingFrontierBook.sol`)

Orders are stored as two endpoint deltas instead of per-interval buckets:

```
deposit [lower, upper) of L:   frontierDelta[lower] += L
                               frontierDelta[upper] -= L
```

`frontierDelta[t]` holds the aggregate liquidity whose *current unfilled
frontier* is t. When price fully crosses `[t, t+s)`, exactly
`frontierDelta[t]` is the active liquidity there (every order covering it
has already been rolled to t by the preceding crossings — crossings happen
left-to-right), so the fill consumes it, rolls the surviving suffix forward
(`frontierDelta[t+s] += frontierDelta[t]`), and stamps
`boundaryFillClock[t+s] = ++fillClock`. A fully consumed order's `+L` rolls
into its own upper and self-cancels against its `-L`. Consumed liquidity
still physically ceases to exist at the interval — the bucket is just
implicit.

Claims and cancels become O(1) against a caller-supplied boundary witness:

- `claimTo(id, F)`: requires `boundaryFillClock[F] > depositClock`. Prefix
  contiguity makes that single check prove everything in
  `[claimedUpper, F)` filled after deposit. Pays the span, advances the
  monotone `claimedUpper` cursor (which replaces per-interval claimed
  flags). Underclaiming is harmless and composable.
- `cancelWithWitness(id, F)`: additionally requires
  `boundaryFillClock[F+s] <= depositClock` (maximality), then removes the
  order's two deltas and returns the unfilled suffix. Both checks are
  two SLOADs; wrong witnesses revert in either direction.
- The lifecycle/epoch logic needs no changes: the same clock comparison
  handles re-fills (a boundary re-stamped by a *later* lifecycle still
  correctly pays an earlier position that filled there before, and
  correctly rejects a later depositor until a fresh fill stamps it anew).

Measured: deposit 139,932 gas at width 10, 1,000 and 100,000 (bit-identical);
witness-claim 28,350; witness-cancel 34,445; swap ~47k per crossed interval
(vs ~25k for the bucket book — the roll costs one extra cold slot);
fragmentation canary and user-count tests flat. The interface-compat
`claim(id)`/`cancel(id)` scan for the frontier on-chain (O(width) fallback);
production frontends compute the witness off-chain.

Dust policy difference: fills collect `ceil(totalL·rate)` per interval;
claims pay `floor(L·spanRate)` floored once over the claimed span (the
single rounding is what keeps payouts O(1); with sqrt-price math the span
rate telescopes to `√P_b − √P_a`). Span-floor ≥ sum-of-interval-floors, and
interval-ceils cover both, so no overclaim — fuzz-verified against the
reference oracle (token0 exact; token1 within bounded wei, never under).

**The venue trade-off (why the fill-clock bucket book still exists):** the
frontier book cannot back a *vanilla* v4 hook holding real pool liquidity.
Only the frontier interval would be materialized in the pool, so one swap
sweeping several intervals would glide through the unmaterialized ones
without converting anything — rolling can't happen mid-swap. Real
per-interval pool liquidity inherently costs O(width) pool writes at
deposit. So:

- **Vanilla v4 hook venue** (R1 option 1) → fill-clock bucket book
  (`RangeTakeProfitHook`), deposit/claim O(width), AMM does the conversion.
- **Vault / custom order pool / external accounting** (R1 options 2–4), or
  a v4 *custom-curve* (return-delta) hook that executes order flow itself →
  rolling-frontier book, everything O(1) except swaps' O(crossed).

Still-true mitigations for the bucket book if it stays the venue choice:
wider tick spacing divides all width costs; a Fenwick range-add could make
its deposit O(log) (claims stay O(width)).

## The v4 hook (Q4 — answered: YES, built and passing)

`src/RangeTakeProfitHook.sol` implements the same mechanism as a real v4 hook
on a real `PoolManager` (v4-core v4.0.0), and the full scenario suite passes
against it with real sqrt-price tick math (`test/HookScenarios.t.sol`).

- The hook owns real pool liquidity: `deposit` adds `L` per interval via
  `modifyLiquidity` inside an unlock callback (token0-only, since the range
  sits above price). The swap itself IS the fill — the AMM converts bucket
  token0 to token1 as price sweeps through.
- `afterSwap` (the only swap-path hook, flags AFTER_INITIALIZE|AFTER_SWAP)
  burns every bucket whose upper boundary was crossed upward, stamps
  `lastFillClock`, zeroes the bucket. Swaps are price-monotonic and
  afterSwap runs before any later swap, so reversal can never touch consumed
  liquidity.
- Measured on the real pool: swap gas is bit-identical for 1 vs 25 users
  behind the crossed ticks (180,526 gas) — S1 holds on the real swap path.

Validated end-to-end on a Base mainnet fork (`test/ForkBaseHook.t.sol`):
a fee-0 WETH/USDC pool with this hook created on the REAL deployed
PoolManager (0x4985...2b2b), orders funded with real WETH via deal(), and
fills driven by the REAL Universal Router 2.1.1 (V4_SWAP + Permit2) — i.e.
the hook's afterSwap fires from a production router path, at realistic
negative ticks (~-198000, ≈ $2,520/WETH). Fill, reversal/no-resurrection,
epoch isolation (Carol), exact-formula USDC claims, and cancel-with-refund
all hold. Run with `FORK=true forge test --match-contract ForkBaseHookTest`.

Two v4 mechanics discovered while building it (both now encoded in tests):

1. **noSelfCall**: v4 suppresses hook callbacks for actions initiated by the
   hook itself. The market/test helper `moveTickTo` therefore swaps through a
   separate `MarketSwapper` contract — real-world routers are unaffected.
2. **Settlement ordering**: `afterSwap` runs before the swapper settles, so
   the manager may not yet hold the swap's token1. Fill proceeds are
   therefore minted as ERC-6909 claim tokens to the hook and redeemed for
   real token1 at user-claim time (`Action.CLAIM` unlock).

Remaining open items for production hardening:
  - **Fee handling**: pool fee is required to be 0 (enforced in
    afterInitialize). A nonzero fee accrues to hook-owned liquidity and
    varies per lifecycle, which would require a per-fill
    `proceedsPerLiquidity` record (small extension, see observation 2).
  - Partially-crossed interval at swap end stays live (reversible) — same
    semantics as the prototype; cancel of a price-straddling interval
    returns the partially-converted mix (token0 + token1).
  - One hook instance binds one pool (afterInitialize); multi-pool support
    means keying interval/position state by PoolId.

## Reference model & testing

`ReferenceBook.sol` is an eager, loop-everyone transcription of the
requirements (O(positions) per fill, by design). The fuzz harness drives
identical random sequences (deposit / move / claim / cancel, 40 actions)
through both books and asserts: identical per-call outputs, identical user
balances after full settlement, identical aggregate liquidity per interval,
zero retained principal, and bounded one-way dust. 2,000 runs clean.

Scenario tests (A–E, lifecycles, boundaries, delayed-claim equivalence) run
against **both** implementations from a shared abstract suite, so the oracle
itself is pinned to the spec.

## Known limitations / next steps

1. Only the token0→token1 (sell-above) direction; the mirror is mechanical.
2. The standalone book keeps a linear price curve; the hook uses real
   sqrt-price math (observation 2 carried over as predicted).
3. Hook open items listed above: nonzero-fee pools, multi-pool keying.
4. No protocol fees, no batch claiming (Q8 left open — claim is owner-only
   here; making it permissionless-to-trigger-but-pay-owner is a one-line
   change if keeper claiming is wanted).
5. uint128 bucket overflow is unchecked beyond Solidity 0.8 reverts; fine for
   a prototype.
