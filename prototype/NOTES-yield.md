# Design: Rehypothecated Liquidity (Aave while quoted)

Status: designed, not implemented. Three integration levels, increasing
effort. The hard question is not earning the yield, it's (a) distributing
it without breaking O(1) claims and (b) staying LIVE when Aave isn't.

## Level 0 — ship today, zero protocol changes: books on static aTokens

Deploy books on the NON-REBASING Aave wrappers (waWETH / stataTokens,
ERC-4626), e.g. a waWETH/USDC book. Conservation holds (raw aTokens rebase
and would strand surplus in the book — never use raw aTokens), unfilled
principal accrues yield to the maker automatically via share appreciation,
and nothing in the contract changes.

Cost: quotes are denominated in token1-per-waWETH, so a resting order's
effective WETH price drifts by ~APY over time (in the TAKER's favor —
orders fill slightly early). Makers requote occasionally (O(1), cheap) or
accept the drift. Takers receive waWETH; routers unwrap. This is the
"yield-bearing pairs are just pairs" observation.

## Level 1 — cluster vaults (product 2): natural and trivial

The MakerVault holds aTokens natively; the sweep's pull path calls
vault.fund(amount) which does aave.withdraw + transfer (one extra call per
sweep, ~100k, amortized over the whole sweep). One owner means ALL yield
questions vanish — it's their money the whole time. Proceeds supply back
into Aave on arrival. This should simply be the standard cluster vault
implementation. Idle quoting capital earns lending yield with zero
accounting machinery.

## Level 2 — public escrowed book (product 1): adapter + policy choice

Book holds its float in aTokens behind a buffered adapter (keep N% hot;
supply/withdraw Aave only when the buffer crosses thresholds, so user ops
don't each pay the Aave gas).

Yield DISTRIBUTION policy — the critical fork:
- (a) Treasury/ops takes it: zero accounting. Ship-first option.
- (b) Yield-funded maker REBATE RATE: realized yield tops up a buffer that
  funds a bonus rate on fills/claims. Rate-based => pure function of level
  => closed-form span claims SURVIVE. Rough justice (yield goes to filled
  makers, not time-weighted resters) but O(1) and honest.
- (c) Exact time-weighted pro-rata to makers: REQUIRES per-position
  integral of principal over the yield index with breakpoints at the
  position's own fill times — path-dependent, same math class as
  pool-accrued fees, breaks the O(1) machinery. DO NOT build. (Per-sweep
  index snapshots in the high-water stack get close, but claims then loop
  over sweeps-in-window. Still no.)
- Note share-denominated quoting does NOT rescue (c): quoting token1 per
  SCALED unit keeps claims closed-form but hands the principal yield to
  the taker via price drift — that's just Level 0 economics.

## The real cost: liveness coupling

Aave withdraw can FAIL (100% utilization, frozen/paused market). If the
sweep/cancel path needs a withdraw, Aave stress becomes taker DoS and
trapped maker funds. Mitigations, all of which should ship together:
- Hot buffer sized for typical sweep volume (keeper or opportunistic
  rebalance).
- IN-KIND EXIT: cancel/claim falls back to delivering aTokens directly if
  the unwrap fails. Funds are never trapped; the user exits holding the
  yield-bearing claim and unwraps later. This single escape hatch removes
  the worst failure mode.
- Sweeps degrade gracefully: fill up to buffer, park (the resumable-sweep
  machinery again).
- Per-book opt-in flag, so plain books carry zero Aave risk surface.

## Recommendation

Level 0 needs nothing from us (document it). Level 1 is the standard
cluster vault — build it WITH the cluster work. Level 2 ships policy (a)
or (b) only, never (c); it's an adapter layer, not a book change.
