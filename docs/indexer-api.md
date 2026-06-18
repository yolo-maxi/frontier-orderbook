# Indexer API

The [Frontier indexer](../indexer) watches the book, factory, and position-NFT
events once, normalizes them into SQLite, and serves the result over REST +
WebSocket. Any client — the UI, bots, aggregators — reads pre-computed state
instead of re-deriving it from `getLogs`. Storage is a single SQLite file; there
is no external infrastructure.

The authoritative HTTP contract is the OpenAPI 3.1 spec at
[`../indexer/openapi.yaml`](../indexer/openapi.yaml) — load it into Swagger UI,
Redoc, or a code generator. This page is the human-readable tour.

> All token amounts are returned as **decimal strings** of the underlying
> `uint256`, so no precision is lost over JSON. Match the conventions in
> [`getting-started.md`](./getting-started.md) and the
> [contract reference](./contract-interface-reference.md).

## Base URL

Local indexer: `http://localhost:8787` (REST) and `ws://localhost:8787` (WS).

## REST endpoints

| Method & path | Returns |
| --- | --- |
| `GET /health` | Liveness probe `{ ok, ts }`. |
| `GET /markets` | All indexed books with tokens, spacing, ticks, fees, hooks. |
| `GET /book/{market}?levels=` | Aggregated live bid/ask depth (approximates `FrontierLens.depth`). |
| `GET /positions/{owner}?live=` | An owner's positions; `live=true` filters to open ones. |
| `GET /trades?market=&taker=&side=&fromBlock=&toBlock=&limit=&cursor=` | Taker trade tape, newest first, with keyset `nextCursor` pagination. |
| `GET /stats/{market}?window=` | Sliding-window stats: trade count, volume by token, token1 fill volume, taker fees, open interest, live positions. |
| `GET /candles/{market}?interval=&from=&to=&limit=` | OHLC candles (`1.0001^tick` price) plus token1 volume, for charting. |
| `GET /account/{owner}` | Per-account rollup across markets, incl. claimed proceeds and claim-token (NFT) holdings. |

Parameters and full response schemas are defined in the
[OpenAPI spec](../indexer/openapi.yaml); `400`/`404` bodies are
`{ "error": string }`.

### Example

```sh
# list markets, then snapshot the inside book and recent trades
curl http://localhost:8787/markets
curl 'http://localhost:8787/book/0xMARKET?levels=50'
curl 'http://localhost:8787/trades?market=0xMARKET&side=buy&limit=20'
```

Pagination is stable as new trades append: pass a prior response's `nextCursor`
back as `cursor` to continue strictly after that `(block, logIndex)` point. A
`null` cursor means you have reached the end.

## WebSocket channels

Two push channels stream live mutations (documented alongside, but outside, the
OpenAPI HTTP surface):

| Channel | URL | Payload |
| --- | --- | --- |
| Fills / trades | `ws://localhost:8787/fills?market=0x...` | `{ type: "fills", data: {…} }` |
| Depth / book mutation | `ws://localhost:8787/depth?market=0x...` | `{ type: "depth", data: {…} }` |

## TypeScript client

A zero-dependency typed client ships as `@frontier/indexer/client`:

```ts
import { FrontierClient } from "@frontier/indexer/client";

const c = new FrontierClient("http://localhost:8787");

const { markets } = await c.markets();
const depth = await c.book(market, 50);
const page = await c.trades({ market, limit: 50 });   // cursor pagination
for await (const t of c.tradesAll({ market })) { /* auto-paginate */ }

const stop = c.subscribeFills((msg) => console.log(msg), { market });
// …later
stop();
```

`subscribeDepth` mirrors `subscribeFills` for book-mutation events; both return
an unsubscribe function.

## Relationship to the on-chain lens

The indexer is the **unbounded-history** companion to
[`FrontierLens`](./contract-interface-reference.md#frontierlens):

- For a point-in-time read straight from the chain (inside market, a single
  position, an owner's live positions in a bounded id window), call
  `bestPrices` / `positionView` / `positionsOf` on the lens.
- For history, search, pagination, candles, and cross-market rollups, query the
  indexer. `GET /book/{market}` approximates `lens.depth`; `GET /positions/{owner}`
  is the unbounded analogue of `lens.positionsOf`.

See [`../indexer/README.md`](../indexer/README.md) for running the service and
its internal layout.
