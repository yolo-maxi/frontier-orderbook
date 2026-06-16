# Implementation Notes

> Historical implementation record. The rolling/linear/shaped book described
> here was the original prototype and is now archived on the
> `archive/rolling-frontier-book` branch. The shipped product is the
> geometric/uniform path: `GeometricFrontierBook` (extends
> `UniformFrontierBook`), with `UniformMakerOps`/`GeometricMakerOps` and the
> `FrontierGeoBookFactory`. The file-map rows below have been repointed to
> the shipped filenames; the surrounding mechanism narrative is preserved.

Companion to `DESIGN.md` (which explains *why* the mechanism is shaped this
way). This file explains *what is built and how it works*, contract by
contract.

## Contract inventory

| File | Role |
|---|---|
| `src/IRangeOrderBook.sol` | Common interface: `deposit / claim / cancel / moveTickTo` + views. All four implementations satisfy it, which is what lets one scenario suite test all of them. |
| `src/RangeTakeProfitBook.sol` | Standalone production candidate. Holds tokens itself; `moveTickTo` is an external market stand-in (caller pays token1, receives consumed token0). Linear price curve placeholder. |
| `src/RangeTakeProfitHook.sol` | The same mechanism as a real Uniswap v4 hook (v4-core v4.0.0). Buckets are real pool liquidity; real sqrt-price math. Includes `MarketSwapper`, a minimal price-limit router used by tests as the "market". |
| `src/UniformFrontierBook.sol` (+ `src/GeometricFrontierBook.sol`) | Width-O(1) shipped book and standalone venue (`GeometricFrontierBook` extends `UniformFrontierBook` with the `1.0001^tick` curve): orders are two endpoint deltas (`frontierDelta[lower] += L`, `frontierDelta[upper] -= L`); fills consume the aggregate frontier and roll it forward one interval. Ask ladders are uniform — the same `liquidity` at every level. Quoters re-price via `requote` — an O(1) in-place move (and optional re-size) of an unfilled order (endpoint-delta writes, tokens settle difference-only, clock refresh preserves freshness). Every level's size must be >= 1 so the value bitmap alone drives sweeps. TWO-SIDED: `depositBid`/`requoteBid`/`claimBid(To)`/`cancelBid(WithWitness)` mirror everything below the price (token0-denominated sizes so claims stay closed-form; descending frontier; fill clocks keyed by lower boundary; own bitmap). One shared pointer; no-crossing is structural: asks deposit strictly above the tick, bids at/below, and moving the pointer through resting liquidity requires paying for it — so the pointer is a real price bounded by best bid/ask, and free moves exist only inside the spread. Takers use `sweepWithLimits(target, maxFills, maxPay, minOut, deadline)` in both directions (parks resumably on either budget). ENDPOINT-TELESCOPED UP-SWEEPS: between order endpoints (bitmap bits, where bit set <=> delta != 0), aggregate size is affine, so a run of any number of thin levels settles with one closed-form series and one absorption; survivors materialize once at the sweep end/park point (storage end-state identical to the per-level roll, so claims/cancels/views are unchanged); per-boundary `boundaryFillClock` is replaced by a monotone high-water stack (one entry per liquidity-moving sweep; `_highSince(clock)` answers frontier/witness queries in O(log sweeps)); `maxFills` counts endpoint-steps and `maxPay` subdivides the final run to the exact affordable thin tick. Sweep cost: O(endpoints crossed + bitmap words), independent of tick fineness. Bids remain per-level (mirror pending). Claims/cancels are O(1) with a boundary witness (`claimTo`, `cancelWithWitness`) or O(log width) without one (the frontier is found by on-chain binary search — the fill predicate is prefix-monotone within a position's range). A tick bitmap lets sweeps skip empty price regions per 256-interval word; `sweep(target, maxFills)` is bounded and resumable (parks at the first unfilled interval). Pointer policy: downward moves are free, permissionless, and provably harmless retreats — depositors bundle a retreat with their deposit, which defeats pointer-pinning griefing. Cannot back a vanilla real-liquidity v4 hook (see DESIGN.md venue trade-off). The original shaped-ladder surface (`depositShaped`/`requoteShaped`, per-level `slope`, second-order `frontierSlope`) and the internal-balance/recycling ledger (`claimInternal`/`recycleBidIntoAsk`/`withdrawInternal`) were removed from the shipped book and are archived on `archive/rolling-frontier-book`. |
| `src/FrontierGeoBookFactory.sol` | Spins up independent, ephemeral geometric books — any pair, any tick spacing, several in parallel; books hold no shared state and need no cleanup. The only factory now; used by both production deploys and tests. |
| `src/ReferenceBook.sol` | Correctness oracle, intentionally naive: every fill loops over every position and credits it eagerly. Exists only to be differentially fuzzed against. |
| `src/MockERC20.sol` | Minimal mintable ERC20 for local tests. |

## Shared state model (bucket implementations; the frontier book replaces interval buckets with endpoint deltas — see its header comment)

```
globalfillClock   uint64   — increments once per interval fill, never resets
intervals[lower]           — one bucket per tick-spacing interval
  .totalLiquidity uint128  — live liquidity in the current lifecycle
  .lastFillClock  uint64   — clock value at the bucket's most recent fill (0 = never)
positions[id]
  .owner, .lower, .upper
  .liquidity      uint128  — per-interval liquidity (uniform across the range)
  .depositClock   uint64   — global clock at deposit time (ONE scalar, not per-interval)
  .live           bool
claimedInterval[id][lower] bool — lazily set on first payout for that interval
```

The single load-bearing predicate, used by claim/cancel/views alike:

```
interval consumed for position  ⟺  intervals[lower].lastFillClock > position.depositClock
```

This works because a fill consumes the *entire* bucket (liquidity → 0), so a
position can only ever be paid by the first fill after its deposit; the
`claimedInterval` flag makes that payment once-only. No epoch ids, no
per-lifecycle ledgers, no history scans.

## Operation flows

**deposit(lower, upper, liquidity)** — validates (`liquidity > 0`,
`lower < upper`, spacing-aligned, `lower > currentTick`); adds `liquidity` to
every bucket in `[lower, upper)`; records the position with
`depositClock = fillClock`; pulls token0.
In the hook: the token0 pull happens inside a `PoolManager.unlock` callback
that does one `modifyLiquidity(+L)` per interval (token0-only, since the
range is strictly above price), then `sync → transferFrom(user → manager) →
settle`.

**fill (swap path)** — standalone book: `moveTickTo(newTick)` fills every
bucket whose upper boundary lies in `(oldTick, newTick]`; downward moves fill
nothing. Hook: `afterSwap` does the identical loop, comparing the pool's
post-swap tick against a hook-tracked `lastTick`; for each crossed non-empty
bucket it burns the hook's pool liquidity there (now 100% token1), stamps
`lastFillClock = ++fillClock`, zeroes the bucket.

**claim(id)** — walks the position's intervals; for each not-yet-claimed
interval with `lastFillClock > depositClock`, marks it claimed and adds
`amount1(interval, L)` (a pure function — see DESIGN.md observation 2).
Pays token1. Callable at any time; pays exactly the filled-so-far portion.

**cancel(id)** — runs claim, then for each *unconsumed* interval removes `L`
from the bucket and returns the principal; marks the position dead. In the
hook, if price currently sits inside one of the position's intervals, the
burn returns the actual mix (part token0, part token1) — the partially
converted interval is never trapped, it just can't be *claimed* while open
because it is still reversible.

## v4 hook specifics

Registered permissions: `AFTER_INITIALIZE | AFTER_SWAP` only (address flag
bits `0x1040`). No liquidity-hook flags, so the hook's own `modifyLiquidity`
calls cannot re-enter it. One hook instance binds one pool (set in
`afterInitialize`); pool fee must be 0 (enforced — see DESIGN.md for why).

Three production-relevant mechanics encoded in this code and its tests:

1. **`noSelfCall`** — v4 suppresses *all* hook callbacks for actions the hook
   itself initiates. Consequence: a hook can never observe its own swaps.
   The test-side market helper (`moveTickTo`) therefore routes through the
   separate `MarketSwapper` contract; real routers are unaffected.
2. **Settlement ordering** — `afterSwap` executes *before* the swapper
   settles its debt, so the manager may not yet hold the swap's input tokens.
   Fill proceeds are therefore minted to the hook as **ERC-6909 claim
   tokens** (`manager.mint`) at fill time and redeemed for real token1 inside
   an unlock at user-claim time (`Action.CLAIM`: `burn` + `take`).
3. **Exact-boundary semantics** — a swap that stops exactly on an initialized
   tick boundary applies the tick transition and reports that tick, so
   "landing on the boundary" fills the interval *below* it. Both the
   standalone book and the hook implement the same rule, and the boundary
   tests pin it.

## Universal Router integration (fork test)

`test/ForkBaseHook.t.sol` drives fills through the deployed Universal Router
2.1.1 on Base (`0xFdf682F51FE81Aa4898F0AE2163d8A55c127fbC7`). Encoding facts,
verified against the deployed router's Sourcify-verified source (do not trust
older examples):

- Command `V4_SWAP = 0x10`; actions `SWAP_EXACT_IN_SINGLE = 0x06`,
  `SETTLE_ALL = 0x0c`, `TAKE_ALL = 0x0f`.
- `ExactInputSingleParams` has **six** fields:
  `(PoolKey, bool zeroForOne, uint128 amountIn, uint128 amountOutMinimum,
  uint256 minHopPriceX36, bytes hookData)`. The `minHopPriceX36` field is a
  per-hop min-execution-price guard added in UR 2.1.x; `0` disables it.
  Older 5-field encodings revert opaquely.
- `OPEN_DELTA = 0`: an `amountIn` of exactly 0 silently means "use full
  credit", not "swap nothing".
- Input funding flows through Permit2 (`token.approve(permit2)` +
  `permit2.approve(token, router, amount, expiration)`).

To make a swap land exactly on a tick boundary with exact-input, the input
amount is computed with the pool's own rounding: per-interval
`getAmount1Delta(..., roundUp=true)`, summed (fee must be 0).

## Build configuration

v4-core v4.0.0 requires `solc 0.8.26`, `evm_version = "cancun"`, and
`via_ir = true` with `optimizer_runs = 44444444` (upstream's setting; other
optimizer values trip a Yul stack-too-deep in the swap code). See
`foundry.toml`. Only `forge-std` and `v4-core` are vendored; the Universal
Router constants above are declared locally in the fork test rather than
pulling in v4-periphery.

## Known gaps (deliberate, prototype scope)

- Sell-token0-upward direction only; the token1→token0 mirror is mechanical
  (R2 marks it optional).
- Hook requires fee-0 pools; nonzero fees need a small per-fill
  `proceedsPerLiquidity` extension (DESIGN.md).
- One pool per hook instance; multi-pool means keying interval/position
  state by `PoolId`.
- `claim` is owner-only; keeper/batch claiming (spec Q8) is a one-line
  change (pay owner, allow any caller) if wanted.
- No sub-range `claim(id, from, to)` in the bucket book — its claims scan
  the full range (the frontier book's `claimTo` subsumes this).
- The frontier book's `activeLiquidity`/`claimable` views are O(width)
  scans (view-only; production frontends compute witnesses off-chain).
- The two books have different dust policies (per-interval floor vs
  collect-ceil/pay-span-floor) — converge before productionizing.
