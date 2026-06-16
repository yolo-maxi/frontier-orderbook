# The Mechanism

Four ideas, layered. Each is independently tested; together they make thin
ticks economical on-chain.

## 1. Orders are two ledger notes (the rolling frontier)

A flat order "5 WETH at every level from A to B" is not stored as hundreds
of per-level entries. It is stored as two **endpoint deltas**:

```
frontierDelta[A] += 5        "+5 begins at A"
frontierDelta[B] -= 5        "ends at B"
```

The only thing that ever reads levels — a taker sweep — walks them in
order anyway, keeping a running total. When a level fully fills, the
aggregate rolls forward one level; a fully consumed order's `+L` rolls
into its own `-L` and vanishes. Consequences, all by construction:

- **Deposits are O(1)** at any width (two writes + a position record).
- **No resurrection**: consumed liquidity physically ceases to exist at a
  level; price reversing cannot re-activate it.
- **Swaps never touch users**: fills act on aggregates only. Gas is
  bit-identical whether 1 or 100 makers share a range.

Bids mirror asks exactly (token0-denominated sizes resting below the
price, a frontier that rolls downward). One shared pointer makes
no-crossing structural: moving the price through resting liquidity *is*
trading into it; only the spread moves for free.

## 2. Claims are one comparison (prefix-contiguity)

A valid order is born strictly above (asks) or below (bids) the price. So
for price to fill any deeper level of the order, it must first have crossed
every nearer one **after the deposit**. An order's personal fill history is
therefore always a contiguous prefix of its range — even when the global
fill history fragments across reversals.

That collapses all epoch/lifecycle bookkeeping into clock comparisons:
each sweep records one *(clock, high-water tick)* entry in a monotone
stack; an order's filled prefix is that high-water clamped to its range,
found by binary search in O(log sweeps). Deposit **freshness** (a new
order never inherits an earlier fill) and **once-only payment** (a
monotone claimed-cursor per position) follow directly. Witness-based
claims/cancels verify in O(1); witnesses are optional sugar.

## 3. Runs settle in closed form (endpoint telescoping)

Between two order endpoints the active ladder is constant per level
(uniform). So a sweep doesn't transition state per tick: it settles the
whole run with **one closed-form series** (token amounts exact to the wei),
absorbs the endpoint, and materializes survivors once at the end. Cost:
O(order endpoints crossed + bitmap words), independent of tick count.
`maxPay` budgets park mid-run at the exact affordable thin tick and resume
losslessly.

## 4. Uniform ladders, composed

The shipped book rests the same `liquidity` at every covered level. One
position = one uniform ladder; a front-loaded or piecewise quoting curve
composes from a few uniform segments; claims stay closed-form. Every level
carries the same ≥1 unit so the sweep bitmap sees it.

## Also in the core

- **Internal balances**: claims can credit an in-book ledger; every deposit
  spends credit first. `recycleBidIntoAsk` flips filled orders to the other
  side with zero token transfers — works with zero approvals.
- **Transferable positions**: ownership moves; claims and refunds follow.
- **Taker protections**: `sweepWithLimits(target, maxSteps, maxPay, minOut,
  deadline)` in both directions, resumable parking on any budget.
- **Solvency discipline**: fills collect ceil per run, claims pay floor per
  span; dust accrues to the book, never a deficit. Differential fuzzing
  holds token0 flows exact against an eager reference implementation.
