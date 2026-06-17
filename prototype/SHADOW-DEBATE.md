# Shadow Liquidity — Design Debate

A threaded, adversarial review of the shadow-liquidity experiment. Two reviewers
argue it out — **Bull** (for) and **Bear** (against) — and the **Maintainer**
responds, tying each thread back to what the code actually does today
(`UniformFrontierBook.sol`, `UniformMakerOps.sol`, see `SHADOW.md` for mechanics).

The point of this doc is not to declare a winner. It is to make the risks
explicit, separate the ones we *mitigated* from the ones we *accepted* from the
ones we *parked*, and give the next person a fair starting line.

---

## Thread A — Does it actually help takers, or is it fake depth?

**Bull.** It is a strict Pareto gain for takers. The mirror can only ever fill at
a price the real book *already printed* — it cannot quote wider. So a taker
crossing the book fills up to ~2× the size at the identical price vector, and no
taker is ever worse off on price. On a book that would slip 80 bps to fill the
back half of an order, the shadow half fills at the real touch instead.

**Bear.** It is fake depth. Half of what the taker fills against has *no price
opinion* — it exists only because a real maker printed. That is materially
misleading: the taker is shown liquidity that would never have offered that
price on its own and that evaporates the instant the real book thins (the mirror
is gated on real fills). It is a depth-spoofing primitive that fills. And the
taker *overpays* for it: standard taker fee on the combined notional **plus** the
30 bps shadow fee on the mirrored leg.

**Maintainer.** The "spoofing" framing is the sharpest objection and we take it
seriously, but it misreads the gating. Spoofing is depth that *vanishes before
you can hit it*; shadow depth is the opposite — it only materializes *at the
moment of and at the price of* a real fill, and it always honors it. It cannot be
pulled. What's fair in the critique: it carries no information, so we must never
render it as if it were a resting maker order. That is exactly why the UI draws
it as a **hatched, desaturated segment** distinct from real depth, with a
`+shadow` tag and a pooled-inventory legend — see `OrderBook.tsx`. On the fee:
yes, the taker pays full freight on the shadow leg. That is deliberate (Thread B),
and the taker still comes out ahead versus walking a thin book, which is the
alternative when shadow is the only incremental depth available.

---

## Thread B — Incentives: who pays, who earns, and do real makers quit?

**Bull.** Routing the 30 bps to the protocol (not the pool) is the whole point.
Shadow flow is *incremental* — it's the size the real book couldn't serve at that
price. Taxing it produces net-new protocol revenue that costs real makers nothing,
and the protocol recycles it as lower maker fees / funded rebates. You tax the
benign copy and subsidize the price-setting original. The two tiers can't
collapse into each other: shadow can't post first, can't set price, earns no
maker treatment — so no maker rationally defects into being a shadow LP to dodge
the quoting work. The flywheel *reinforces* the lit book.

**Bear.** It free-rides on price discovery and will cannibalize the real book.
Shadow LPs earn the book spread without ever quoting, repricing, or bearing
chosen-price risk — they consume the makers' price discovery as a public good and
split the best top-of-book flow with them. Worse, the budget split (Thread F)
*halves* the real makers' fill to hand flow to the mirror. Rational makers widen
or leave; the prints the mirror echoes get worse; the pool's adverse selection
worsens; the structure spirals into the thing it depends on.

**Maintainer.** The alignment argument holds *only* because shadow earns no maker
treatment and fills strictly second — both true in code (`_mirrorShadowAsk` /
`_mirrorShadowBid` run after `_sweepUp`/`_sweepDown`, and there is no rebate path
for shadow). The cannibalization risk is real but its magnitude is dominated by
the budget split, not by the mirror concept itself. With a correct
`min(reserves, residualBudget)` split (Thread F), the real book is filled in full
first and shadow only ever takes overflow the makers *couldn't* serve — at which
point makers lose nothing and the free-riding reduces to "shadow earns spread on
flow makers had already turned away." That is a defensible tier. The current flat
halving is the part that genuinely risks driving makers off, and it is a parked
shortcut, not a design commitment.

---

## Thread C — Are shadow LPs a sacrificial, adversely-selected book?

**Bear.** This is the core flaw. The mirror fires on *every* sweep, 1:1, at the
print, and the LP cannot pull, reprice, or decline. So shadow LPs are forced to
take the *second half of every aggressive cross* — exactly the flow most likely
to be informed. They buy when informed takers sell and sell when they buy. Spread
capture is bounded; adverse selection is not. And because the pool never
rebalances and holds no price view, inventory drifts monotonically toward the
losing asset — pure LVR, with the option premium going to the *protocol* (the
fee), not to the LP bearing the risk. That's a structurally underpriced LP
position; rational capital won't supply it, and mispriced capital will blow up.

**Bull.** Compared to a vanilla AMM, shadow LPs are *better* off: in an AMM the LP
is always the marginal counterparty; here a real maker is filled first and the
shadow LP only takes the residual at a price a competing maker independently
judged acceptable. It's a second-loss position behind real price judgment, with
spread compensation, and no quoting race to win.

**Maintainer.** Both are right about different things. The "second-loss behind a
real maker" structure is real and genuinely softer than AMM LVR — the LP never
sets the price and never fills *ahead* of a maker who declined. But the Bear is
correct that we do not *additionally* compensate the LP for inventory risk beyond
the book spread, and that a single non-rebalancing pool drifts. We accept this
for the experiment and state it plainly: **shadow LPs are taking a directional
inventory bet financed by spread capture, and must actively manage exposure by
withdrawing** (`withdrawShadow` is pro-rata and always available). Productionizing
should explore (a) sharing part of the shadow fee back to LPs as risk
compensation, and (b) inventory-aware mirror caps. Neither is in this branch.

---

## Thread D — Manipulation and the "last-fill oracle"

**Bear.** "Mirror at the price the real book just printed" is a same-block,
oracle-free oracle — the most manipulable kind. Thin the real book (or post your
own thin level and take it), print an off-market fill, and the mirror will match
the next taker at your manufactured price and *force* the pool to trade. There's
no TWAP, no deviation guard, no minimum-real-depth gate, no per-block mirror cap.
On a shallow book one wei of self-dealing moves the touch.

**Bull.** To move the mirror you must move the *real* book — i.e., actually trade
against real makers at real prices and pay that cost. The mirror has no price of
its own to feed; there is no stale-quote or reference-price surface. You can't
drain it at a price nobody accepted.

**Maintainer.** The Bull is right that there is no *stale* price to exploit — the
mirror price equals a fill a counterparty accepted in the same step, which kills
the classic oracle-latency family. The Bear is right that on a *thin* book the
"counterparty who accepted it" can be the attacker's own posted level, so the
manipulation cost collapses to the spread the attacker pays themselves plus fees.
This is a real, unmitigated risk in the current code: there is **no minimum-real-
depth gate before mirroring**. We accept it for the experiment and flag it as the
top item for any real deployment: gate the mirror on a minimum real fill size /
real resting depth, and/or cap mirrored notional per block. Until then, shadow
inventory should only be seeded on books with non-trivial real depth.

---

## Thread E — Prediction markets: cold-start vs. resolution

**Bull.** Cold-start is the killer problem for new prediction markets — no maker
quotes a market with no flow, no taker comes to a market with no depth. Shadow
breaks it from the supply side: one deposit makes every print that one lonely
maker posts fillable at up to 2×, with deposit-and-forget capital that doesn't
need to model the outcome. The first brave quoter recruits passive depth behind
them.

**Bear.** And resolution destroys it. Prediction prices gap to 0/1. A
mirror-accumulating pool is, by construction, long the side informed flow was
selling — i.e., structurally long the *loser* into resolution — with no chance to
exit a discontinuous gap. A sophisticated actor who knows the outcome sweeps the
real book just before resolution specifically to force the mirror onto the losing
side near terminal prices, then collects. The mechanism has zero terminal-value
awareness, and on a prediction market the terminal state is not an edge case —
it's *every* market.

**Maintainer.** This is the most important prediction-market-specific objection
and it is correct. There is no resolution awareness in the contract. Our position:
shadow liquidity is a **cold-start tool, not a hold-to-resolution position.**
Sponsors should withdraw shadow inventory as a market approaches resolution, and a
production version should add a resolution-aware halt (stop mirroring once a
market is within some window of, or flagged for, resolution). We document this as
an accepted limitation rather than pretending the mirror is safe to leave parked
through settlement.

---

## Thread F — Implementation shortcuts (the honest part)

**Bear.** The experiment ships several individually-attackable shortcuts:
(1) `grossBudget/2` halves the real fill *whenever any shadow inventory exists*,
even dust — wasting taker budget and degrading real execution; (2) single global
pool, no ranges, no price view; (3) capped only by reserves, no partial-level
rounding discipline (dust extraction surface); (4) fee always settles in token1;
(5) first depositor sets the pool ratio (the ERC-4626 first-deposit / share-
inflation surface).

**Maintainer.** Triaged honestly:

- **(1) Budget halving — accepted shortcut, highest-impact fix.** Real and worth
  fixing first: it should be `min(shadowReserves, residualBudget)` *after* the
  real book gets full budget, not a blind 50/50. Documented in `SHADOW.md`.
- **(2) Single pool — by design for the experiment.** O(1), no per-tick state. A
  price-view/ranged version is a different, larger design.
- **(3) Rounding — mitigated.** The mirror uses `_mulDivUp` for the taker's input
  (book-favorable) and is capped by reserves; the same basis-point floor rule as
  the rest of the fee system applies. We have not found a wei-drain, but a
  fuzz/invariant pass dedicated to shadow rounding is warranted before production.
- **(4) token1-settled fee — mitigated, not a liability.** On an ask mirror the
  fee comes out of the token1 the taker is paying in; on a bid mirror `grossOut`
  is capped at `shadowReserve1` *before* the fee is carved, so the pool can always
  pay it. The "pool drifted to all token0 can't pay the fee" scenario can't occur
  because a bid mirror that would need token1 the pool doesn't have is reserve-
  capped away.
- **(5) First-depositor ratio — accepted, low severity here.** `depositShadow`
  requires both amounts on the first deposit and mints `amount0 + amount1` shares;
  later deposits are clipped to the pool ratio. A donation/inflation guard
  (minimum first deposit, or virtual shares) is standard hardening for production
  and is not in this branch.

---

## Where this nets out

Shadow liquidity is a clean, oracle-free way to bootstrap depth and to convert
parasitic-but-benign overflow volume into protocol revenue that subsidizes real
makers. Its real, accepted risks are: adverse selection / inventory drift on
shadow LPs (Thread C), thin-book manipulability for lack of a min-depth gate
(Thread D), and prediction-market resolution exposure (Thread E). Its most
fixable mistake is the budget halving (Thread F.1). None of these are fatal to the
*idea*; all of them must be closed — or explicitly bounded — before this is more
than an experiment.
