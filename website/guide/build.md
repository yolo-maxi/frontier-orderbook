# Build with Frontier

Frontier is a venue, not a walled garden. The book is a contract; everything
above it — SDK, MCP server, indexer, agent skill — is open and typed. Pick the
layer you need.

<FeatureGrid only="build" />

## The SDK — typed wrappers + agents

[`@frontier/sdk`](https://github.com/yolo-maxi/frontier-orderbook/tree/main/sdk)
ships every deploy-day contract as an `as const` ABI for full
[viem](https://viem.sh) type inference, plus `MarketCreator`, `MakerAgent`, and
`TakerAgent` helpers that fold the *quote → slippage → submit* dance into one
call.

```ts
import { TakerAgent } from "@frontier/sdk";

const taker = new TakerAgent(ROUTER, LENS, opts);
const { received0 } = await taker.buyExactIn({
  book,
  amount1In: 1000n * 10n ** 6n, // 1,000 USDC
  slippageBps: 50,              // 0.5% — quoted, applied, submitted
});
```

Make a market with `MakerAgent`, then harvest with the keeper-friendly
`claimAuto`: it settles to the position's on-chain frontier and reverts cheaply
when there's nothing material to claim — no more off-chain "is this tx worth
it?" race. Read your whole book in one round trip with the lens snapshot
methods `positionsOf` and `bestPrices`.

## The MCP server — Frontier as agent tools

[`@frontier/mcp`](https://github.com/yolo-maxi/frontier-orderbook/tree/main/mcp)
exposes the market / maker / taker / position / lens surface as Model Context
Protocol tools, each with **describe + simulate + execute**. Point Claude
Desktop or any MCP client at it and an agent can quote, place ladders, and claim
fills with transaction simulation before anything is signed.

## The indexer — REST + WebSocket over chain state

The [indexer](https://github.com/yolo-maxi/frontier-orderbook/tree/main/indexer)
watches book / factory / position-NFT events once, normalizes them into SQLite,
and serves markets, positions, the trade tape, stats, OHLC candles, and depth
over REST + WebSocket. No external infrastructure — storage is a single file.

```sh
curl http://localhost:8787/markets
curl 'http://localhost:8787/book/0xMARKET?levels=50'
```

The full HTTP contract is an OpenAPI 3.1 spec; a zero-dependency typed client
ships as `@frontier/indexer/client` with cursor pagination and live `fills` /
`depth` subscriptions.

## The agent skill — drop-in operating guide

A packaged
[Claude Agent Skill](https://github.com/yolo-maxi/frontier-orderbook/tree/main/skill)
teaches an agent the whole venue: how to route an intent to a contract call,
the guardrails to apply on every write (always quote first, always bound a
sweep, payouts only ever go to the owner), and worked maker/taker/creator
recipes.

## What to read

| Layer | Reference |
| --- | --- |
| Core model + first trade | [Getting started](https://github.com/yolo-maxi/frontier-orderbook/blob/main/docs/getting-started.md) |
| Every method / event / revert | [Contract interface reference](https://github.com/yolo-maxi/frontier-orderbook/blob/main/docs/contract-interface-reference.md) |
| Indexer REST + WebSocket | [Indexer API](https://github.com/yolo-maxi/frontier-orderbook/blob/main/docs/indexer-api.md) |
| Delegating to a bot without custody | [Delegatable Permissions](/guide/permissions) |
| Pricing every op in dollars | [Gas](/guide/gas) |

All four layers — SDK, MCP, indexer, skill — are generated from the same
canonical ABIs, so they never drift from the contracts they wrap.
