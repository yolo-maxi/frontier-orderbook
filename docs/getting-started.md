# Getting started

Frontier is a thin-tick on-chain central-limit order book and prediction-market
venue. There is no operator: a market is a contract, an order is a range of
limit prices, and a fill is a settled on-chain event. This page is the shortest
path from "what is it" to "I made my first trade or quote."

Pick your lane:

| You want to… | Go to |
| --- | --- |
| Trade on the live demo right now | [Trade in the browser](#trade-in-the-browser) |
| Build software against Frontier | [Build with the SDK](#build-with-the-sdk) |
| Wire Frontier into an AI agent | [Agents & MCP](#agents-and-mcp) |
| Query indexed markets / positions / trades | [Query the indexer](#query-the-indexer) |
| Look up an exact method or revert | [`contract-interface-reference.md`](./contract-interface-reference.md) |

## Core model

Five ideas carry everything else:

- **`token0` is the base asset, `token1` the quote.** Asks sell `token0` for
  `token1`; bids buy `token0` with `token1`.
- **An order is a range, not a price.** A position covers a half-open tick range
  `[lower, upper)`, ticks aligned to `tickSpacing`. One position can span
  thousands of thin levels and costs the same to place as one level.
- **Prices live on a geometric grid:** the price at tick `t` is `1.0001^t`.
  Spacing is fixed per market; a tighter spacing is a finer grid.
- **Fills wait for you.** When the market trades through your prices, the
  proceeds accrue on-chain and are claimable whenever. Nothing expires, no
  keeper is required.
- **Always quote → apply slippage → submit** for taker swaps. Quotes are
  point-in-time; the book can move before your transaction lands.

A prediction market is just a Frontier book where `token0` is a YES outcome
token and `token1` is the collateral (e.g. USDC). Price *is* probability: a
YES trading at `0.62` USDC is a 62% implied chance. Everything below works
identically whether the book is ETH-USDC or YES-USDC.

## Trade in the browser

The fastest way to see a real fill settle.

1. Open **<https://clob.repo.box>** — a demo wallet is created and gas-funded
   for you (it's a devnet, chain id `84009`, 2s blocks).
2. Hit **Faucet** for test WETH + USDC.
3. **Trade** tab: market or limit, with an execution-exact quote (average price,
   impact, minimum received).
4. **Make** tab: drag out a ladder across a price range and watch it land on
   the chart. Collect fills in **Positions**.

Deployed addresses are served live at
[`/deployment.json`](https://clob.repo.box/deployment.json). See the
[Live Demo Guide](https://clob.repo.box/docs/guide/demo) for a walkthrough.

## Build with the SDK

[`@frontier/sdk`](../sdk) ships typed ABI wrappers (`as const` for full viem
inference) plus `MarketCreator`, `MakerAgent`, and `TakerAgent` helpers.

```sh
pnpm add @frontier/sdk viem
```

```ts
import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { TakerAgent } from "@frontier/sdk";

const account = privateKeyToAccount(process.env.PK as `0x${string}`);
const opts = {
  publicClient: createPublicClient({ transport: http(process.env.RPC_URL) }),
  walletClient: createWalletClient({ account, transport: http(process.env.RPC_URL) }),
  account,
};

// quote → slippage → submit, all in one helper
const taker = new TakerAgent(ROUTER, LENS, opts);
const { received0 } = await taker.buyExactIn({ book, amount1In: 1000n * 10n ** 6n, slippageBps: 50 });
```

To **make** a market, place a ladder with `MakerAgent`, then harvest with the
keeper-friendly `claimAuto` (settles to the position's on-chain
[`frontierOf`](./contract-interface-reference.md#ask-maker) frontier and reverts
cheaply when there's nothing material to claim). Read your whole book in one
call with the lens snapshot methods
[`positionsOf` / `bestPrices`](./contract-interface-reference.md#frontierlens).

Full surface and worked examples: [`../sdk/README.md`](../sdk/README.md).

## Agents and MCP

- **MCP server** — [`@frontier/mcp`](../mcp) exposes the market / maker / taker /
  position / lens surface as Model Context Protocol tools with describe +
  simulate + execute. Point any MCP client (Claude Desktop, etc.) at it.
- **Agent skill** — [`../skill/SKILL.md`](../skill/SKILL.md) is a packaged
  Claude Agent Skill; [`../skill.md`](../skill.md) is the canonical prose
  operating guide.
- **Decision tree** — [`agent-decision-tree.md`](./agent-decision-tree.md) maps
  an intent to the exact contract call, with the guardrails to apply on every
  write.

## Query the indexer

The [indexer](../indexer) watches book / factory / position-NFT events and
serves normalized markets, positions, trades, stats, and depth over REST +
WebSocket. The full HTTP surface is specified in
[`../indexer/openapi.yaml`](../indexer/openapi.yaml) and described on the
[Indexer API](./indexer-api.md) page.

```sh
curl http://localhost:8787/markets
curl http://localhost:8787/book/0xMARKET?levels=50
```

## Where to go next

- [`contract-interface-reference.md`](./contract-interface-reference.md) — every
  read/write method, event, and revert.
- [`frontier-abi-interface.md`](./frontier-abi-interface.md) — compact ABI map +
  deploy script reference.
- [`indexer-api.md`](./indexer-api.md) — the read API in depth.
- [`deployment-schema.json`](./deployment-schema.json) /
  [`position-schema.json`](./position-schema.json) — machine-readable schemas.
