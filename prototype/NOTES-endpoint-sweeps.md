# Design: Endpoint-Bounded Sweeps (thin ticks for free)

Status: IMPLEMENTED 2026-06-10 on top of the shaped-orders version (ask
side; bids still per-level — mirror pending). Measured: a 5% move across 500
ACTIVE thin levels from 5 makers sweeps for 218,895 gas isolated (~23M
before, ~105x); fineness is taker-free up to the bitmap word walk (5,000
levels in one order: +43k over 50 levels). See test/FrontierOzempic.t.sol.

## Problem

The only real cost of super-thin ticks is the taker sweep: ~50k gas per
crossed non-empty interval, decomposing as
  ~22k  boundaryFillClock stamp (fresh slot per boundary)
  ~20k  rolling the delta into the next boundary (fresh slot)
  rest  zeroing (refunded), bitmap, event, math
Makers never pay for thinness (deposit/requote/claim are width-independent).

## Fix: make sweeps O(order endpoints crossed), independent of tick count

Three changes, each removing one per-interval cost:

### 1. Run telescoping (removes per-interval math + rolls)
Between consecutive set bits, active liquidity is constant (uniform orders)
or linear-in-level (shaped orders). Either way one closed-form span/quadratic
series settles the whole run — the code already has both formulas
(_rateSum arithmetic series; _spanAmt1 quadratic for shapes). The sweep keeps
two accumulators (running value V, running slope S), absorbs each endpoint
(V += frontierDelta[t]; S += frontierSlope[t]; zero both — zeroing earns
refunds), and collects proceeds per run:
  run [a,b), n levels: sum_k (V + S*k) * rate(a + k*s)  — O(1).
IMPORTANT with shaped orders: the bitmap must mark slope endpoints too
(bit set <=> frontierDelta != 0 OR frontierSlope != 0), otherwise a run
would skip a slope change. Absorb both at each endpoint.

### 2. High-water stack replaces per-boundary clocks (removes the 22k stamp)
Drop `boundaryFillClock` entirely. Each liquidity-moving sweep appends ONE
record to a monotone stack:
  struct HighWater { uint64 clock; int24 high; }   // high = topBoundary covered
  push: pop entries with high <= newHigh, then push  (clocks increase,
        highs decrease; popped entries are dominated for every query)
Frontier query (replaces binary search over stamps):
  highSince(depClock) = stack binary search: FIRST entry with clock > dep
  frontier(p) = clamp(highSince(p.depositClock), [p.claimedUpper, p.upper])
Soundness: a sweep reaching boundary H crossed every boundary <= H after
that clock (sweeps are contiguous; pointer continuity); prefix-contiguity
turns that into per-position fill proof. A sweep cannot cover a live
position's levels without consuming its liquidity (bits force absorption),
so stamps are always backed by real fills. Lifecycle isolation: identical
clock-comparison semantics as before (deposit after a sweep sees only later
entries). claimTo/cancel verify `target <= frontier(p)` in O(log) — the
separate witness machinery becomes optional sugar.

### 3. Materialize survivors once (removes the 20k roll)
At sweep end U (= floorAligned(target)) or park endpoint:
  frontierSlope[U] += S_running (absorbing U's own entry per current
  convention); frontierDelta[U] += V_last + S_final.
Intermediate boundaries are never written. Invariant preserved: a live
position's value contribution sits exactly at its frontier, so cancel's
delta removal is unchanged. Park semantics: budget counts ENDPOINTS
(maxSteps), parks AT the next unconsumed endpoint, merging survivors with
its delta; resumable.

## Expected effect

Crossing one order spanning 1,000 thin ticks: 1 endpoint + 1 run
(~15-25k gas) instead of 1,000 x 50k. Sweep cost becomes
O(endpoints + bitmap words traversed). Tick grids can then be as fine as the
int24 domain allows (own price function — e.g. 0.1bp/tick covers ~1e36 price
range), making whole-interval fill granularity economically negligible.
This supersedes the need for sub-interval watermarks (NOTES-partial-fills.md
stays parked permanently).

## Residual thin-tick costs (all minor)
- Principal quantization: L per level; total principal rounds to a multiple
  of level count.
- Dust: collect ceil per RUN (not per interval) — strictly less dust than
  per-interval ceils; payouts unchanged (floor per claimed span).
- Events: emit RunFilled(from, to, ...) + Swept(clock) instead of
  per-interval IntervalFilled; indexers expand runs.

## Test impact when implementing
- sweep budget semantics change (intervals -> endpoints): rewrite
  testResumableSweep with distinct-size stacked positions (equal adjacent
  single-interval orders net their shared boundary delta to zero and merge
  into one run — correct behavior, but makes a poor budget test).
- FrontierGas testSwapGasScalesOnlyWithCrossedIntervals becomes
  *flat* for one wide order (that's the point); replace with
  (a) flat-vs-width-of-one-order, (b) linear-vs-endpoint-count.
- Anything reading book.boundaryFillClock (FrontierQuoter helper) switches
  to isConsumedFor / frontier views.
- cancelWithWitness keeps its error strings by comparing the supplied
  witness against the computed frontier (<= "frontier not filled",
  >= "frontier not maximal").
- Differential fuzz needs no changes (token0 exact, token1 tolerance, delta
  conservation all hold; market-side collection differs only in dust).
