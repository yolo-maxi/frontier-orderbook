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
---

<div class="fr-hero-strip">
  <span><span class="dot">●</span> <b>$0.001</b> ticks</span>
  <span><span class="dot">●</span> <b>1,335×</b> cheaper sweeps</span>
  <span><span class="dot">●</span> <b>no operator</b></span>
  <span><span class="dot">●</span> fills that <b>wait for you</b></span>
</div>

<FeatureGrid />

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
