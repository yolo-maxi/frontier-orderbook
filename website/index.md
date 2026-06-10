---
layout: home
hero:
  name: "FRONTIER"
  text: "An on-chain order book with exchange-grade precision"
  tagline: Trade at prices that move in tenths of a cent. Place whole ladders of limit orders in one click. Claim your fills whenever you like — fully on-chain, no operator.
  actions:
    - theme: brand
      text: Open the exchange
      link: https://clob.repo.box
    - theme: alt
      text: Try it in 30 seconds
      link: /guide/demo
features:
  - title: Thin-tick precision
    details: Prices step in increments a centralized exchange would envy — on ETH, fractions of a cent — and trading stays cheap no matter how fine the grid is.
  - title: Ladders, not single orders
    details: Quote a whole price range at once — flat, or weighted toward the touch. One click, one transaction, one position to manage.
  - title: Fills you claim on your time
    details: When the market trades through your prices, your proceeds are simply yours. Claim now, claim later — nothing expires, nothing needs a keeper.
  - title: Safe automation
    details: Let a bot manage your quotes without ever holding your funds. Grants are per-action and expirable; payouts only ever go to you.
---

## Try it now

1. **[Open the exchange](https://clob.repo.box)** — a demo wallet is created for you automatically.
2. Hit **Faucet** for test WETH + USDC.
3. **Trade**: market buy or sell with a live, exact quote — and watch the
   order book on the chart.
4. **Make**: drag out a ladder and see exactly where it will sit before you
   place it. Your positions stay visible on the chart as they fill.

![The exchange](/exchange.png)

The market you'll see is live: bots quote ETH-USDC around the real
Coinbase price at a ±0.1% spread, and a flow bot trades against them.

*Want to know how it works under the hood? Start with
[The Mechanism](/guide/mechanism), or see [the numbers](/guide/gas).*
