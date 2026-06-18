# Experiment: Shadow Liquidity

**Question:** can a market launch with depth it doesn't really have — without
faking a price, and without quietly subsidising the people who provide that
synthetic depth at the expense of honest makers?

**Answer:** yes; built on the uniform book, 12 tests passing. Shadow liquidity
is a single pooled inventory that **mirrors real fills at the book price**, pays
the protocol a full fee on every mirror, and earns no maker treatment.

## What it is

A taker crossing the book hits resting maker orders. With shadow liquidity live,
*after* the real fill settles, a pooled token0+token1 inventory mirrors that same
fill — at the exact price the real book just printed — up to the size its
reserves allow. The taker buys (or sells) roughly twice as much, all at the real
book's price. The shadow pool never posts a level of its own; it has no opinion
on price. It only echoes what real price discovery already produced.

LPs add inventory with `depositShadow` and receive pro-rata shares (an AMM-style
pool, oracle-free; the first deposit sets the ratio). They earn the book spread
on mirrored size and bear inventory risk, exactly like the maker they shadow.

## The fee twist — why honest makers come out ahead

Every shadow-mirrored fill pays a fee (30 bps in the experiment) on the quote
leg, routed to the **protocol**, never retained by the pool. Shadow depth is
explicitly *not* a maker: no maker-fee waiver, no rebate eligibility. The taker
also pays the normal taker fee on the combined real+shadow notional.

The intuition: shadow volume is extra protocol revenue from flow that would not
otherwise route through real makers. That revenue is what lets the protocol
charge real, price-discovering makers **less** (lower fees / funded rebates).
Synthetic depth pays to ride real price discovery; the people doing the price
discovery get paid for it.

## Why it matters for prediction markets

New prediction markets are the worst cold-start problem in the book: they launch
with almost no depth, the first takers get terrible fills, and the market looks
dead before it has a chance. Shadow liquidity lets a sponsor seed one pooled
inventory that makes the *entire* book fill deeper from block one, without anyone
having to babysit a ladder of limit orders or quote a price they can't justify
on a brand-new outcome. In the demo UI (default **Prediction** mode, YES/USDC),
seeded shadow depth shows up as a hatched extension on each order-book level,
visually distinct from real resting orders.

## Seeing it in the demo

Open the **Shadow** tab to add or withdraw pooled inventory and watch the
order book: real depth is the solid bar, shadow-mirrored depth is the hatched
segment to its left, capped by pooled reserves, with a `+shadow` tag on each
level's size and a pooled-inventory legend in the header.

## Honest caveats

This is an experiment with deliberate shortcuts — most notably a flat
budget-halving between real and shadow fills (capital-inefficient when shadow
inventory is small), a single global pool with no price view, and a constant
fee rate. The case *against* the design — adverse selection on shadow LPs,
the "phantom depth" market-integrity critique, free-riding on real makers, and
resolution-gap risk in prediction markets — is argued out in full in the
project's design debate (`prototype/SHADOW-DEBATE.md`), alongside the mechanics
write-up (`prototype/SHADOW.md`).
