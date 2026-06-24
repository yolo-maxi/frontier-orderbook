# Live Demo Guide

**App: <https://frontier-pm.repo.box>** · RPC: `https://rpc.testnet.arc.network`
(chain id 84009, 2s blocks) · addresses: served at
[`/deployment.json`](https://frontier-pm.repo.box/deployment.json)

![The exchange](/exchange.png)

## Using the exchange

1. The app creates a **demo wallet** in your browser on first load and
   funds its gas automatically (it's a devnet).
2. Hit **Faucet** — mints 10 WETH + 50,000 USDC.
3. **Trade** tab: market buy/sell with live, execution-exact quotes
   (average price, impact, min received, slippage presets).
4. **Make** tab: place limit ladders — pick a price range and a size per
   level (uniform across the range). One position can span thousands of
   thin levels; placing it costs by endpoints/bitmap words, not by every
   covered price level.
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
cd prototype
FOUNDRY_PROFILE=deploy forge script script/DeployFrontier.s.sol:DeployFrontier \
  --rpc-url "$RPC_URL" --broadcast
```

Required env: `DEPLOYER_KEY`, `TOKEN0`, `TOKEN1`, `TICK_SPACING`, and
`START_TICK`. Optional env: `DEPLOY_NAME`, `DEPLOY_OUT`,
`FEE_RECIPIENT`, `MAKER_FEE_BPS`, and `TAKER_FEE_BPS`; fees default to
zero and are capped at 1,000 bps. Demo faucet keys are devnet only, never
reuse the pattern anywhere real.
