# Experiment: Uniswap-Style LP on the Book

**Question:** can passive, two-sided, AMM-style liquidity coexist with
ordinary limit orders on the same venue?

**Answer (shipped):** `RangeLP` — a personal LP vault holding both tokens
that quotes **symmetric ladders around the mid** (asks above, bids below),
a discretized x·y=k position living directly on the orderbook.

- Fills rotate inventory between the tokens exactly as an AMM position
  changes composition (tested: price drifts up through the asks → vault
  inventory rotates toward USDC).
- `rebalance()` re-centers around the new price, posting as much of each
  side as current inventory affords. Management is **delegatable** — a
  keeper bot can rebalance via registry grants without custody.
- `close()` settles everything; tests assert zero value stuck in the
  vault or book.
- `RangeLPFactory` opens a vault in one call (the UI/bots use it).

What this replicates from AMM LPing: passive two-sided liquidity, spread
capture, inventory rotation. What it doesn't: continuous infinitesimal
rebalancing — it's keeper-stepped, which is also how production ALM vaults
(Arrakis/Gamma) actually behave — and fee-on-volume revenue; earnings come
from the quoted spread itself. Shaped ladders can approximate any
liquidity curve, including x·y=k's, with a few linear segments via the
MakerKit.
