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
order's effective underlying price drifts by roughly APY *in the taker's
favor*. Makers requote occasionally or accept the drift.

On the devnet, `MockYieldVault` (with a public `drip()`) stands in for
Aave; on a real chain, point a book at waWETH or a Morpho vault share —
no code changes.

**Level 1 (shipped as an experiment):** `YieldRangeLP` is a personal
market-making vault whose idle token0/token1 inventory sits in 4626-style
vaults and is pulled back just-in-time on `rebalance()`. Posted principal
still lives in the book while quoted; idle inventory earns lending yield.
`close()` exits in kind if a vault redeem fails, so the owner receives the
yield shares rather than getting stuck behind a frozen lending market.
Tests cover idle-capital yield, close returning principal plus yield, and
the in-kind failure path in `test/YieldRangeLP.t.sol`.

**Level 2 (designed, not built — `NOTES-yield.md`):** buffered adapters
for posted capital, if the Level 1 vault pattern proves worth hardening.
