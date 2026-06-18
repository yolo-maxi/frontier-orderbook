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

## A book is a belief, priced

A prediction market is a Frontier book where the price *is* the probability. List
a YES outcome token against USDC and the order book does the rest: a YES resting
at **$0.62** is a 62%-implied bet, a limit order is a conditional wager, and the
spread is the market's uncertainty made visible. No bonding curve, no LMSR
operator setting odds — just real bids and asks on a thin-tick grid, settling
onchain.

<div class="fr-pm">
  <div class="fr-pm-book">
    <div class="fr-pm-row ask"><span>NO &nbsp;0.41</span><span class="bar"><i style="width:38%"></i></span><span class="sz">1,200</span></div>
    <div class="fr-pm-row ask"><span>NO &nbsp;0.40</span><span class="bar"><i style="width:62%"></i></span><span class="sz">3,050</span></div>
    <div class="fr-pm-frontier"><span>← 62% YES</span><span>the frontier</span></div>
    <div class="fr-pm-row bid"><span>YES 0.62</span><span class="bar"><i style="width:70%"></i></span><span class="sz">4,400</span></div>
    <div class="fr-pm-row bid"><span>YES 0.61</span><span class="bar"><i style="width:33%"></i></span><span class="sz">980</span></div>
  </div>
  <div class="fr-pm-copy">
    <p><b>Probability is the y-axis.</b> Every tick is a half-cent of implied odds; the book is the crowd's distribution over the outcome.</p>
    <p><b>Make the odds, don't take them.</b> Seed a fresh market with one ladder across the range — no curve to babysit, fills accrue and claim whenever.</p>
    <p><b>Resolution is just the last trade.</b> Winners hold tokens worth $1, losers $0. It's the same settlement that powers every fill.</p>
    <p class="fr-pm-cta"><a href="https://clob.repo.box">Open a market →</a> · <a href="/guide/mechanism">How the book works →</a></p>
  </div>
</div>

## The whole order book, onchain

<FeatureGrid />

## Build on the venue

The book is a contract; everything above it is open and typed. A
[TypeScript SDK](/guide/build), an [MCP server](/guide/build) that hands the
venue to any agent, an [indexer](/guide/build) serving markets, trades, and depth
over REST + WebSocket, and a drop-in [agent skill](/guide/build) — all generated
from the same canonical ABIs, so they never drift from the contracts.

*[Build with Frontier →](/guide/build)*

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
