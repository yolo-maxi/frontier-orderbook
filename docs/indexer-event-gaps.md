# Frontier event surface: indexer gap report

**Question asked:** *"Are the events we emit sufficient to build an indexer?"*

**Method:** instead of reasoning about it, we built one. A minimal, dependency-free
indexer (`prototype/indexer/`) consumes nothing but logs in the exact shape
`eth_getLogs` returns (address, topics, data, blockNumber, logIndex) and tries to
reconstruct venue state with **zero contract storage reads**. A Foundry scenario
(`prototype/test/IndexerFixture.t.sol`) drives a realistic multi-actor session
against the *deployed* `GeometricFrontierBook` (created through the production
`FrontierGeoBookFactory`), records every log, and also writes a ground-truth file
of the values an indexer would want. The indexer reconciles against that truth and
prints, field by field, what it can and cannot recover.

**Verdict:** with the event surface *as it was*, an indexer **cannot** be built for
the default deployment. The single most important reason: **the default deploy is
zero-fee**, and in zero-fee mode the only sweep-time events are `RunFilled`, which
carry neither the taker nor the amounts that moved. Several maker-side facts
(order side, claim token, cancel interpretation) were also unrecoverable.

This report documents the gaps as found, then the **additive** event changes that
close them (now landed in this branch), proven by the same indexer going from
**10/26 fields recovered to 26/26**.

---

## 1. Why zero-fee is the worst (and default) case

`script/DeployFrontier.s.sol` defaults `MAKER_FEE_BPS=0` and `TAKER_FEE_BPS=0`.
`MakerFee` / `TakerFee` are only emitted when their bps are non-zero
(`FrontierBookBase._chargeMakerFee` / `_payTakerFee`). So a default-config book
emits **no fee events at all**.

That matters because the fee events were accidentally carrying the only
indexer-critical data that exists nowhere else:

| Fact | Only source (pre-fix) | Present in zero-fee deploy? |
|---|---|---|
| taker (trader) identity | `TakerFee.payer` | **no** |
| taker input token + amount | `TakerFee.token` / `totalPaid` | **no** |
| claim payout token | `MakerFee.token` | **no** |
| cancel proceeds token | `MakerFee.token` | **no** |

So enabling fees *masks* the gaps. The honest test is the zero-fee book, and there
the surface is plainly insufficient.

---

## 2. Findings as found (pre-fix)

Events emitted by the deployed book/ops/factory (geometric, uniform-only):

```
FrontierGeoBookFactory: BookCreated(book, token0, token1, tickSpacing, startTick,
                                    creator, hooks, feeRecipient, makerFeeBps, takerFeeBps)
FrontierBookBase:       Deposit(positionId, owner, lower, upper, liquidity)
                        RunFilled(fromLevel, toBoundary, startSize, slopePerLevel, clock)
                        Claim(positionId, proceeds1)
                        Cancel(positionId, proceeds1, principal0)
                        Requote(positionId, lower, upper, liquidity)
                        PositionTransferred(positionId, from, to)
                        MakerFee(...)  // only if makerFeeBps>0
                        TakerFee(...)  // only if takerFeeBps>0
```

### Can reconstruct (pre-fix)
- **Markets / books** — `BookCreated` is complete (tokens, spacing, start tick, fee
  config, creator, hooks). ✅
- **Position identity** — owner / range / liquidity from `Deposit`, kept current
  through `Requote` and `PositionTransferred` (both well-formed). ✅
- **Claim / cancel amounts** — the scalar values are present (but see below for
  *which token* they are). ✅
- **Sweep direction** — inferable from `RunFilled` tick ordering
  (`toBoundary > fromLevel` ⇒ up-sweep). ✅
- **Per-run gross token0 fill** — `startSize * levels` from `RunFilled` is exact and
  curve-independent. ✅ (the token1 leg needs the curve — see "derivable" below.)

### Cannot reconstruct (pre-fix) — the gaps

| # | Missing fact | Why | Affected events |
|---|---|---|---|
| G1 | **Order side (ask vs bid)** | `Deposit` has no `isBid`; ask and bid deposits emit the identical signature. Negative ticks are not a reliable discriminator (asks and bids can both sit at negative ticks). | `Deposit` |
| G2 | **Taker identity** | No event carries the sweep's `msg.sender` except `TakerFee.payer` (fee-only). | `RunFilled` |
| G3 | **Trade amounts in/out (taker view)** | `RunFilled` carries per-level `startSize`, not the settled `paid`/`received`. The aggregate the taker actually moved — across runs, parking, and fees — is nowhere. `TakerFee.totalPaid` covers only the *input* leg, only with fees on. | `RunFilled` |
| G4 | **Claim payout token** | `Claim(positionId, proceeds1)` — field is named `proceeds1` but an ask pays token1 and a bid pays token0. Without side (G1) the token is ambiguous. | `Claim` |
| G5 | **Cancel token interpretation** | `Cancel(positionId, proceeds1, principal0)` reuses the same two slots for an ask `(proceeds1, principal0)` and a bid `(proceeds0, refund1)`. Without side, you cannot tell which token each amount is. | `Cancel` |
| G6 | **Book price after a sweep** | `_currentTick` changes on every sweep but no event records the reached tick. Only *partially* inferable from the last `RunFilled.toBoundary` (wrong when the sweep parks mid-run). | (none) |
| G7 | **Position fill progress / remaining principal** | No event exposes a position's filled frontier or `claimedUpper`. Remaining principal (refund on cancel) and "is this order filled" were unknowable from events. | (none) |

### Derivable-but-not-emitted (a fragility note, not a hard gap)
- **token1 leg of each fill** (token1 paid on up-sweeps / received on down-sweeps)
  is reconstructable *only by reimplementing the on-chain geometric curve and its
  exact integer rounding* (`GeoTickMath.powX18` + the telescoped `geoSpan` with
  per-book `geoD`). A float reimplementation drifts by wei (the indexer shows
  `13006401480200015488` vs the exact `13006401480200000000`). An indexer that must
  match on-chain settlement to the wei has to port the fixed-point math — brittle and
  a standing maintenance liability.

---

## 3. Recommended changes — and what landed

All changes are **additive** (new event / new field), no behavior changes, and were
chosen to be cheap in deployed bytecode (the geometric book is EIP-170 constrained).

### Change A — `Deposit` gains `bool isBid`  *(closes G1, and transitively G4 + G5)*

```solidity
event Deposit(uint256 indexed positionId, address indexed owner,
              int24 lower, int24 upper, uint128 liquidity, bool isBid);
```

This is the highest-leverage fix. Because `Claim`, `Cancel`, and `Requote` are all
keyed by `positionId`, once the indexer knows a position's side from its `Deposit`
it interprets every later event for that position — **no change to `Claim` /
`Cancel` / `Requote` is needed**. One bool closes three gaps.

### Change B — new `Swept` summary, once per taker sweep  *(closes G2, G3, G6)*

```solidity
event Swept(address indexed taker, int24 tickBefore, int24 tickAfter,
            uint256 amountIn, uint256 amountOut, uint256 takerFee);
```

Emitted once at the end of `sweepWithLimits` (not in the per-run hot loop), in both
`UniformFrontierBook` (deployed) and `RollingFrontierBook` (demo). It gives the
taker, the direction and price movement (`tickBefore → tickAfter`, which also makes
`tickAfter` the post-sweep `currentTick`), and the exact settled `amountIn` (incl.
taker fee), `amountOut`, and `takerFee` — **in every fee config**, with no curve
replay. Token sides follow from the direction (`tickAfter > tickBefore` ⇒ up-sweep:
`amountIn` is token1, `amountOut` is token0; reversed on a down-sweep).

### G7 (position progress) — now derivable, no further event needed

With `Swept.tickAfter` (the reached tick = the frontier) and deposit ordering, the
indexer replays sweeps against each position to recover its filled frontier
**exactly**, and from that the **unfilled principal in token0 units** (`liquidity ×
unfilled levels`) — curve-free. The indexer does this and matches the on-chain
`unfilledPrincipal` view to the wei (e.g. pos1 → `3000000000000000000`).

### Optional, not implemented — `claimedTo` on `Claim`

`Claim(positionId, proceeds)` still doesn't say *which levels* were claimed, so the
filled-but-unclaimed split (the live `claimable` view) needs either the curve or a
`claimedTo` tick on the event. The *remaining-principal* case (the one that matters
for "what's still backing this order") is already covered via G7. Adding a
`claimedTo` tick to `Claim` would make the claimable split exact too; left out here
to keep the change minimal and the geometric book comfortably under EIP-170.

---

## 4. Result after the changes

The same indexer, same fixtures, reconciled against ground truth:

| Config | Before | After |
|---|---|---|
| zero-fee (default deploy) | 10 recovered / 11 missing / 4 derivable | **26 recovered / 0 missing** |
| fee-enabled | 16 recovered / 6 missing / 3 derivable | **26 recovered / 0 missing** |

Now recovered purely from events (no curve, no storage reads): markets, position
identity + **side**, requotes, transfers, **taker**, **exact trade amounts in/out**,
**post-sweep tick**, claim amount + **token**, cancel amounts + **token
interpretation**, and **per-position unfilled principal**.

---

## 5. Reproduce

```bash
cd prototype
# regenerate fixtures (drives the scenario, records logs + ground truth)
forge test --match-contract IndexerFixtureGen
# run the indexer reconstruction + reconciliation
node indexer/indexer.mjs scenario-nofee
node indexer/indexer.mjs scenario-fee
# assert the new events emit the needed data
forge test --match-contract IndexerEventsTest
```

See `prototype/indexer/README.md` for the indexer's design and the
`RECOVERED / DERIVABLE / MISSING` legend.
