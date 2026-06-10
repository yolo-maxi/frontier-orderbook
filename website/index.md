---
layout: home
hero:
  name: "FRONTIER"
  text: "A thin-tick on-chain CLOB"
  tagline: CEX-grade price precision with settlement work compressed to order endpoints — not ticks. Live on a public devnet, market-made by delegated bots.
  actions:
    - theme: brand
      text: Open the exchange
      link: https://clob.repo.box
    - theme: alt
      text: The mechanism
      link: /guide/mechanism
    - theme: alt
      text: Live demo guide
      link: /guide/demo
features:
  - title: Thin ticks, free for takers
    details: A 5% move through 5,000 active thin price levels settles for ~210k gas. Per-level settlement needed 287M — ten blocks. Tick fineness costs makers nothing and takers almost nothing.
  - title: O(1) maker operations
    details: Placing, re-pricing, or re-shaping a ladder costs the same whether it spans 10 levels or 100,000. Requotes never lose queue standing — levels are pro-rata.
  - title: Everything is delegatable
    details: Every owner gate consults a permission registry. Bots hold selector-scoped, expirable grants; payouts always go to owners. The live market maker runs this way.
  - title: Uniswap-shaped periphery
    details: Aggregators integrate via swapExactTokensForTokens. A lens quotes to the wei. A maker kit places whole quoting curves in one transaction.
---

## What this is

Frontier is a standalone on-chain central limit order book. Makers post
one-way range orders (ladders) across price ticks; takers sweep them through
a price pointer bounded by best bid and best ask. Settlement is **lazy**:
fills update aggregate state only, and makers claim later — claims verify
against a single high-water record per sweep, in O(log).

It grew out of a take-profit-orders spec for Uniswap v4 (that lineage —
including a hook validated on a Base mainnet fork through the real Universal
Router — [is preserved](/experiments/v4-hook)), then became its own venue
when the math turned out to beat the constraints of hosting it inside an AMM.

## The numbers that matter

| Operation | Cost (isolated, per-tx) |
|---|---|
| Place / re-price a ladder, any width | ~190–250k / ~104k |
| Witness claim / cancel | ~66k / ~86k |
| Taker, per maker order crossed | ~10–13k |
| 500 active thin levels, one sweep | 167k (was 21.9M) |

156 Foundry tests, differential-fuzzed against an eager reference oracle,
plus a Base-mainnet fork suite for the v4 lineage.

::: warning Prototype status
Unaudited demo software. The devnet runs with the EVM code-size limit
disabled (see [Roadmap & Caveats](/roadmap)).
:::
