# Experiments: Yield, Hooks, LP

Three experiments Fran asked for alongside the main build. All three are
implemented, tested, and deployed on the devnet.

## 1. Yield on at-rest tokens (`src/MockYieldVault.sol`, `test/Yield.t.sol`)

Implements Level 0 of NOTES-yield.md: **yield-bearing pairs are just
pairs.** The book trades an ERC-4626 SHARE token (waWETH-style); share
price appreciates as interest accrues, so a maker's unfilled resting
principal earns yield automatically — the book needs zero changes, and
conservation is untouched because shares never rebase. The test proves a
maker who quoted 10 levels, sat through a 10% drip, and cancelled 6
unfilled levels redeems 6.6 WETH for those 6 share-units: yield earned
while quoted. On the devnet, `MockYieldVault` (with a public `drip()`)
stands in for Aave/Morpho; on a real chain, point the book at waWETH or a
Morpho vault share. Levels 1-2 (vault-native aTokens with live withdraw on
sweep) remain designed-not-built in NOTES-yield.md.

Honest cost: quotes are denominated in share units, so an order's
effective underlying price drifts by ~APY in the taker's favor; makers
requote occasionally (O(1)) or accept it.

## 2. v4-style hooks (`src/hooks/`, `test/Hooks.t.sol`)

Same shape as Uniswap v4: a hook contract's PERMISSIONS ARE ITS ADDRESS
(low 6 bits = beforeDeposit/afterDeposit/beforeSweep/afterSweep/afterClaim/
afterCancel), bound immutably at book creation
(`factory.createBookWithHooks`), callbacks must return their own selector,
and the book skips callbacks for hook-initiated actions (the noSelfCall
lesson we learned on the real v4 fork). Reverting in a `before` hook
blocks the action. `GatedVolumeHook` example: maker allowlisting + volume
tracking. Tests cover gating, observation, unflagged-callback skipping,
and hookless books being byte-identical to before.

## 3. Uniswap-style LP alongside the orderbook (`src/periphery/RangeLP.sol`, `test/RangeLP.t.sol`)

A personal LP vault that quotes SYMMETRIC LADDERS around the mid — a
discretized x*y=k position living on the orderbook, coexisting with
ordinary limit orders. Fills rotate inventory between the tokens exactly
like an AMM position changing composition; `rebalance()` re-centers around
the new price, posting as much of each side as current inventory affords;
`close()` settles everything. Management is delegatable via the permission
registry (a keeper bot can rebalance without custody).

What this replicates from AMM LPing: passive two-sided liquidity, spread
capture, inventory rotation. What it doesn't: continuous infinitesimal
rebalancing (it's keeper-stepped, like ALM vaults such as Arrakis/Gamma in
practice) and fee-on-volume revenue (earnings come from the quoted spread
itself). Shaped ladders (front-loaded near the touch) can approximate any
liquidity curve, including x*y=k's, with a few linear segments.
