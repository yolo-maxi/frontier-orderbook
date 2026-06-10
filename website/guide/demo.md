# Live Demo Guide

**App: <https://clob.repo.box>** · RPC: `https://rpc-clob.repo.box`
(chain id 84009, 2s blocks) · addresses: served at
[`/deployment.json`](https://clob.repo.box/deployment.json)

## Using the exchange

1. The app creates a **demo wallet** in your browser on first load and
   funds its gas automatically (it's a devnet).
2. Hit **Faucet** — mints 10 WETH + 50,000 USDC.
3. **Trade** tab: market buy/sell with live, execution-exact quotes
   (average price, impact, min received, slippage presets).
4. **Make** tab: place limit ladders — pick a price range, size per
   level, optionally front-load with a slope. One position can span
   thousands of thin levels; placing it costs the same as one level.
5. **Positions** tab: live fill status; claim proceeds or cancel for the
   unfilled remainder at any time. Settlement is lazy — claims never
   expire and never depend on anyone else.

## What's trading against you

Two bots run on the host (pm2):

- **`clob-mm-bot`** quotes ±0.1% around the live Coinbase ETH price,
  1,000 thin levels per side, requoting every ~12s. Its fast path is
  signed by a **delegated operator key** (registry grants for exactly
  `requote`/`requoteBid`); fills force the owner-key settle path.
- **`clob-taker-bot`** sends randomized market orders through the router.

So the book you see tracks real ETH, with a live ~1–2 bps spread.

## Redeploying

```sh
cd prototype && ./deploy-devnet.sh        # devnet (this is what's live)
RPC=https://sepolia.base.org DEPLOYER_KEY=0x... ./deploy-devnet.sh   # Base Sepolia, once funded
```

The devnet runs anvil with the code-size limit disabled — see
[Roadmap & Caveats](/roadmap). Demo faucet keys are the well-known anvil
keys: devnet only, never reuse the pattern anywhere real.
