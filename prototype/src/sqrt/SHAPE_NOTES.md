# Book-shape exploration — what shape should the frontier book be?

Scope: the **liquidity shape** (how a maker's position size maps to token depth
across ticks) and the **sizing convention** (which token, if any, is the
numeraire — and whether a bid is literally an ask reflected). All candidates
keep the three non-negotiables the production book already has: O(1) sweeps
(closed-form telescoping), per-level exact price `P(t) = 1.0001^t`, and
solvency (`floor(x)+floor(y) <= floor(x+y)` — no rounding leak).

This note is grounded in measured gas (`test/SqrtShapeBench.t.sol`) and
exactness tests (`test/SqrtTickLiquidity.t.sol`). Numbers below are marginal
amount-math gas through a non-inlinable boundary (~700 gas of that is the
external-call overhead, constant across rows).

## The candidates

### A. Production — flat token0-L, geometric curve (current `main`)
`L` is token0-units per level. An ASK escrows `L * levels` token0 (flat base
depth). A BID escrows one geometric span `L*(P(b)-P(a))/(P(s)-1e18)` token1 and
buys `L` token0 per level. Both sides quote the SAME L token0 at each price and
fill at exactly `P(t)`. Asymmetric *math*, symmetric *semantics*.

### B. Symmetric geomean-L via isqrt (the `SqrtLiquidityBook` POC)
`L = sqrt(amount0*amount1)` — neither token is the numeraire. ASK escrows the
token0 leg `L/sqrtP`, BID escrows the token1 leg `L*sqrtP`. The bid is the ask
reflected: `leg0(t) == leg1(-t)`. `sqrtP` is computed as `isqrt(pow*1e18)`.

### C. Symmetric geomean-L via a sqrt TABLE (`SqrtTickMath` — added here)
Same shape as B, but `sqrtP(t) = 1.0001^(t/2)` comes from a binary-exp table
instead of a Babylonian loop. The table is GeoTickMath's constants shifted up
one bit plus a single new bottom constant `sqrt(1.0001)`. This is the *fair*
version of the symmetric design — B's gas is an artifact of isqrt, not of
symmetry.

### (ii) Flat-escrow symmetric — considered, rejected without coding
Both sides escrow flat (`count*L`): ask escrows L token0, bid escrows L token1.
Symmetric and cheap, but the bid's token0-acquired then varies with price
(`L/P(t)` per level), which is a *less* intuitive promise than A's "I want L
token0 at each price," for identical lifecycle gas. No advantage over A.

## Measured gas (marginal amount math, per call)

- A ask escrow `count*L` ...... **~0.9k**  (no curve sum at all)
- A bid escrow `geoSpan` (pow) . **~3.0k**
- B span via isqrt ............ **~37.7k**  (isqrt Babylonian loop dominates)
- C span via sqrt table ....... **~3.5k**  (amount0 3.7k / amount1 3.5k)

Raw primitives: `powX18` ~1.6k, `sqrtPowX18` (table) ~1.3k, `sqrtPriceX18`
(pow+isqrt) ~13k. The table is ~10x cheaper than isqrt and on par with pow.

### The decisive number — curve math over a position's LIFECYCLE (deposit+claim)

- A (flat token0-L): one side = `count*L` + `geoSpan` = **~3.9k**
- C (geomean table): one side = two sqrt spans = **~7.2k**

A is ~1.8x cheaper because flatness eliminates one curve sum entirely: a flat
token0 leg needs no telescoping. The symmetric design pays a curve sum on BOTH
deposit and claim because neither leg is flat. B is a non-starter (~75k/side).

## Correctness / exactness

- All three are solvency-safe: split span <= whole span, verified to <= 2 wei.
  This is the only invariant the book actually relies on (it compares
  span-to-span, ceil deposit vs floor payout).
- B admits a parts-in-1e14 error on "single-level span == leg" because isqrt
  is not multiplicatively consistent. ADVERSARIAL FINDING: the table (C) does
  NOT fix this — at spacing=1 the span denominator `sqrtP(1)-1e18 ~= 5e13`
  amplifies a 1-wei numerator error to ~2e4 wei for both B and C (~3e-14
  relative, negligible). "span == leg" is a cosmetic interpretation check, not
  a solvency property. C's real wins over B are gas (~10x) and that `sqrtP`
  agrees with the pow book's `P` (`sqrtP^2 == P`), keeping one shared curve.
- C's reflection symmetry `leg0(t)==leg1(-t)` holds to 2 wei (exact recip).

## Market behavior

- A (flat token0-L): constant base depth per tick. A symmetric ladder of L
  asks above and L bids below moves the maker's token0 inventory by exactly
  ±L per tick crossed — the most natural market-making symmetry, constant
  inventory step. Renders trivially as a CLOB: every price row shows size L.
- C (geomean-L): token0 depth slopes as `L/sqrtP` (more size cheap, less
  expensive) — Uniswap-v3's constant-liquidity profile. Inventory step per
  tick is `L/sqrtP`, still symmetric but no longer constant. Harder to render
  as "size at price," and the slope is a surprising default for a limit maker.

## Recommendation

**Keep A — the production flat token0-L geometric book — as the shape.** It
wins on the priority order Fran set (correctness, gas, simplicity, UX):
- Gas: ~1.8x less curve math per lifecycle; the only shape where one leg needs
  no curve sum at all.
- Simplicity: one existing curve table (GeoTickMath), no second `SqrtTickMath`,
  intuitive constant-size-per-tick depth, trivial orderbook rendering.
- Market: constant base-inventory step per tick — the cleanest MM symmetry.

The geomean-symmetric design is elegant and, with the table, finally gas-viable
— but it buys only *deposit-amount reflection symmetry* and *currency-neutral
L*, neither of which improves real market behavior over A, at the cost of ~2x
curve math, a second constant table, and a sloped depth profile.

**If** Fran wants currency-neutral L for product reasons (quoting positions in
geomean units, or collapsing the two sides into one literally-reflected code
path to shrink the contract), then do it with the TABLE (C / `SqrtTickMath`) —
never the isqrt POC (B), which is ~10x the gas and no more accurate. C is the
upgrade path that makes "symmetric" affordable; B should be treated as a
correctness reference only.

## Open questions for Fran

- Is the goal *market* symmetry (A already gives constant-inventory-step
  symmetry) or *code/contract-size* symmetry (one reflected path)? They point
  to different winners.
- Do any product surfaces need to quote a position as a single currency-neutral
  `L = sqrt(a0*a1)`? If not, A's token0-L is strictly simpler.
- The frontier SWEEP is inherently directional (up fills asks, down fills
  bids); reflection unifies the AMOUNT math but not the sweep. How much
  contract-size saving does unifying only the amount math actually yield?
