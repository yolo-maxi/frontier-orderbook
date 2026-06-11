---
layout: home
hero:
  name: "FRONTIER"
  text: "The order book is back onchain."
  tagline: A full central-limit order book, living on the chain. Prices in tenths of a cent. Whole ladders in one click. Fills that wait for you. No operator — nothing to trust but the chain.
  actions:
    - theme: brand
      text: Trade at the edge
      link: https://clob.repo.box
    - theme: alt
      text: 30 seconds to your first fill
      link: /guide/demo
    - theme: alt
      text: How it works
      link: /guide/mechanism
features:
  - title: Ticks finer than a cent
    details: Prices step in $0.001 increments — granularity a centralized exchange would envy. The gas bill doesn't care how fine the grid is. That's the breakthrough; the numbers are in the table.
    link: /guide/gas
    linkText: See the numbers
  - title: Ladders, not orders
    details: Quote a whole price range in one transaction — flat or weighted toward the touch. One click. One position. A market maker's whole curve, placed like a single order.
  - title: Your fills wait for you
    details: When the market trades through your prices, the proceeds are yours — onchain, accruing, claimable whenever. Nothing expires. Nothing needs a keeper. Claim a month later if you like.
  - title: Bots without custody
    details: Hand a bot the keys to your quotes, never your coins. Grants are per-action and expirable, payouts only ever go to you. Market-make in your sleep.
  - title: Price it before you send it
    details: Every operation, benchmarked as a real transaction, priced in dollars on Ethereum, Base, or Gnosis. A market order on an L2 costs less than the dust you'd ignore on the floor.
    link: /guide/gas
    linkText: Price it on your chain
  - title: Books that do things
    details: v4-style hooks turn any book into its own TWAP oracle, a gated market, a circuit-breaker venue, or a rewards program. Implemented and tested — not a roadmap slide.
    link: /guide/hooks
    linkText: See the experiments
---

## Live right now

The demo exchange is a real market: bots quote ETH-USDC around the live
Coinbase price at a ±0.1% spread, a flow bot trades against them, and the
book settles every fill onchain.

1. **[Open the exchange](https://clob.repo.box)** — a demo wallet is created for you.
2. Hit **Faucet** for test WETH + USDC.
3. **Trade** — market or limit, with a quote that's exact to the wei.
4. **Make** — drag out a ladder, watch it land on the chart, collect your
   fills.

![The exchange](/exchange.png)

## Why this matters

Order books lost to AMMs onchain for one reason: every price level used
to cost gas, so fine-grained books were unexecutable — a 5,000-level
sweep cost ten blocks of gas. Frontier's settlement compression collapses
any run of levels into one closed-form update: that same sweep now costs
**1,335× less** and fineness is free. The trade-off that created the AMM
era is gone.

What's left is what order books were always better at: real limit
orders, real price-time priority on a grid, depth you can see, and
market making that doesn't bleed against arbitrage by design.

*Start with [The Mechanism](/guide/mechanism), price it in
[Gas](/guide/gas), or read [how we talk about it](/brand).*
