# Experiment: Yield While Quoted

**Question:** can resting order capital earn lending yield (Aave/Morpho)
without breaking the book's accounting?

**Answer (Level 0, shipped):** yes, with zero protocol changes — *if* the
book trades the **non-rebasing share token** of a yield vault rather than
the raw asset. "Yield-bearing pairs are just pairs."

The book quotes a waWETH-style ERC-4626 share against USDC. Shares never
rebase, so every conservation invariant is untouched; the share *price*
appreciates as interest accrues, so a maker's unfilled principal earns
automatically. The test is concrete: quote 10 levels, drip 10% to the
vault while resting, get filled on 4, cancel — the 6 returned share-units
redeem **6.6 WETH**. Yield earned while quoted, claims still O(1).

The honest cost: orders are denominated in share units, so a resting
order's effective underlying price drifts by ~APY *in the taker's favor*.
Makers requote occasionally (O(1), ~104k gas) or accept the drift.

On the devnet, `MockYieldVault` (with a public `drip()`) stands in for
Aave; on a real chain, point a book at waWETH or a Morpho vault share —
no code changes.

**Levels 1–2 (designed, not built — `NOTES-yield.md`):** vault-native
quoting capital, where a maker vault holds aTokens and the sweep's pull
path withdraws just-in-time (~one extra call per sweep, amortized across
the whole sweep). All yield questions vanish for single-owner vaults —
this is the natural upgrade for the RangeLP/cluster-vault pattern.
