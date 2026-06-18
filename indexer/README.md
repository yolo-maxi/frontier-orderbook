# Frontier Indexer + API

A best-in-class indexer and read API for the Frontier on-chain orderbook.

Today the UI replays chain state client-side (`ui/src/state/app.tsx` polls
`getLogs` + per-position `readContract` every few seconds). This service moves
that work server-side: it watches the book's events once, normalizes them into
SQLite, and serves them over REST + WebSocket so any client (UI, bots,
aggregators) reads pre-computed state instead of re-deriving it.

Zero external infra: storage is a single SQLite file via `better-sqlite3`.

## Layout

```
src/
  abi.ts            event + view ABIs (book / factory / position-NFT)
  config.ts         env + prototype/deployments/latest.json loader
  db/
    schema.ts       normalized schema (markets, positions, fills, trades,
                    account_states, claim_tokens, fees, cursors)
    index.ts        open/migrate + cursor helpers
  ingest.ts         pure event -> DB apply layer (shared by live + replay)
  indexer/
    decode.ts       raw viem logs -> DecodedEvent
    indexer.ts      persistent viem getLogs watcher (resumable, pre-Swept safe)
    run.ts          standalone indexer process
  queries.ts        read model for the REST API (markets, depth, trades,
                    pagination, stats, OHLC candles)
  api.ts            Fastify REST + WebSocket server
  client.ts         typed REST + WS client (import as @frontier/indexer/client)
  bus.ts            in-process pub/sub bridging ingest -> WebSocket
  server.ts         combined entrypoint (indexer + API)
openapi.yaml        OpenAPI 3.1 spec for the REST surface
test/               vitest suite (ingest, decode, indexer, api, stats,
                    reconcile, client)
```

## TypeScript client

A zero-dependency client lives at `src/client.ts` and is exported as
`@frontier/indexer/client`:

```ts
import { FrontierClient } from "@frontier/indexer/client";

const c = new FrontierClient("http://localhost:8787");
const { markets } = await c.markets();
const page = await c.trades({ market, limit: 50 });           // cursor pagination
for await (const t of c.tradesAll({ market })) { /* ... */ }  // auto-paginate
const stats = await c.stats(market);                          // 24h volume / OI
const { candles } = await c.candles(market, 3600);            // hourly OHLC
const stop = c.subscribeFills((m) => console.log(m), { market }); // WS
```

In Node, pass a `WebSocket` impl for the WS helpers:
`new FrontierClient(url, { WebSocket: (await import("ws")).default })`.

## Claim-token reconciliation

An ERC-721 `Transfer` from the position-NFT wrapper alone does not carry the
wrapped book `positionId`. The indexer fills in `claim_tokens.position_id` /
`market` after the fact, cheapest path first:

1. **DB correlation** (`reconcileClaimTokensFromDeposits`): if the mint shares a
   block with exactly one `Deposit`, that's the wrapped position (no RPC).
2. **On-chain** (`Indexer.reconcileClaimTokens`): read `bookPositionOf(tokenId)`
   on the wrapper, then match the returned id to the book that holds it (indexed
   row, else a `positions(id)` probe per book).

Both run every `syncOnce`; tokens that can't be resolved yet stay pending and
are retried next pass (pre-Swept / partial-ABI wrappers are tolerated).

## Schema (I2)

Normalized tables, all uint256/int256 amounts stored as decimal **strings**
(SQLite has no 256-bit integer):

- **markets** — one row per book (from `BookCreated`, or seeded from config /
  a pre-Swept deployment with no factory).
- **positions** — one row per book `positionId`, updated by
  `Deposit` / `Requote` / `Cancel` / `Claim` / `PositionTransferred`.
- **fills** — maker-side fill records from `IntervalFilled` and `RunFilled`.
- **trades** — taker-side executions from `TakerFee`; the public trade tape,
  with inferred `buy`/`sell` side (input token vs. `token0`).
- **account_states** — per `(market, owner)` rollup: live/total positions,
  proceeds claimed, principal returned, maker/taker fees paid.
- **claim_tokens** — explicit **claimTokenId token-flow**. A `tokenId` in
  `FrontierPositionNFT` wraps a book `positionId`; holding the token *is* the
  claim right on that position's proceeds. Mint / transfer / burn (unwrap) are
  tracked from the ERC-721 `Transfer` log.
- **fees** — maker/taker fee accounting (`MakerFee` / `TakerFee`).
- **cursors** — per-scope last-indexed block for resumable sync.

## Indexer (I3)

`src/indexer/indexer.ts` polls `eth_getLogs` per scope (factory, each book,
each NFT wrapper), decodes via viem, and applies through the shared
`applyEvent`/`applyBatch` ingest layer.

- **Resumable** — a `cursors` row per scope; restarts pick up where they left
  off.
- **Pre-Swept safe** — restrictive RPCs that reject wide ranges or unknown
  topics cause the window to halve and retry; a single failing block is logged
  and skipped so the indexer always makes forward progress. A book that does
  not expose `currentTick()` is tolerated (the tick column simply stays null).
- **Unit-testable** — the same ingest path is driven by replayed sample logs
  in tests, and the watcher accepts an injected (mock) viem client. See
  `test/indexer.test.ts`.

## REST API (I5)

Fastify. See `openapi.yaml` for the full spec.

| Method | Path                  | Description                              |
| ------ | --------------------- | ---------------------------------------- |
| GET    | `/markets`            | List indexed markets                     |
| GET    | `/book/:market`       | Depth snapshot (aggregated live levels)  |
| GET    | `/positions/:owner`   | Positions for an owner (+ claim token)   |
| GET    | `/trades`             | Filterable trade tape (`market`, `taker`, `side`, `fromBlock`, `toBlock`, `limit`) |
| GET    | `/account/:owner`     | Per-account rollup + held claim tokens   |
| GET    | `/health`             | Liveness                                 |

## WebSocket (I7)

`@fastify/websocket`. Connect and receive JSON frames:

- `ws://host/fills?market=0x...` — every fill / trade as it is indexed.
- `ws://host/depth?market=0x...` — book mutations (deposit/requote/cancel,
  claim-token transfers).

The `market` query param is an optional filter. On connect the server sends a
`{type:"subscribed"}` frame, then `{type:"fills"|"depth", data:{...}}` frames.

## Running

```bash
pnpm install          # self-rooted workspace; compiles better-sqlite3
pnpm test             # vitest against replayed sample events
pnpm dev              # indexer + API with reload (tsx watch)
pnpm start            # indexer + API
pnpm index            # indexer only (writer); add --once for a one-shot pass
pnpm build            # tsc -> dist/
```

### Configuration

All optional; defaults read `prototype/deployments/latest.json` so the service
runs against the devnet with no flags.

| Env                | Default                          | Notes                               |
| ------------------ | -------------------------------- | ----------------------------------- |
| `RPC_URL`          | deployment `rpcUrl`              | JSON-RPC endpoint                   |
| `CHAIN_ID`         | deployment `chainId`             |                                     |
| `BOOKS`            | deployment `contracts.book`      | comma-separated book addresses      |
| `FACTORY`          | deployment `contracts.factory`   | watch `BookCreated` to auto-discover|
| `NFT_WRAPPERS`     | —                                | FrontierPositionNFT address(es)     |
| `START_BLOCK`      | `0`                              | first block when no cursor exists   |
| `BATCH_SIZE`       | `5000`                           | max blocks per `getLogs`            |
| `POLL_INTERVAL_MS` | `2500`                           |                                     |
| `DB_PATH`          | `./data/frontier.db`             | `:memory:` for ephemeral            |
| `PORT`             | `8787`                           | HTTP/WS port                        |

If neither `BOOKS` nor `FACTORY` is set, the server runs API-only (read-only
over an existing DB) without constructing an RPC client.

## Notes / deferred

- **Depth snapshot** is reconstructed from indexed live positions (sum of
  per-level liquidity over `[lower, upper)`), which matches the
  uniform/geometric book where ladder sizes are flat. Slope-shaped ladders
  (archived `RollingFrontierBook` path) are not modeled. For wei-exact quotes,
  callers should still use `FrontierLens` via `eth_call`; this endpoint is for
  fast, cheap depth display.
- The claim-token mint log carries only the `tokenId`, not the wrapped
  `positionId`. The `claim_tokens` row records the token + owner immediately;
  resolving `position_id`/`market` requires a `bookPositionOf(tokenId)` view
  read, left as a follow-up reconciliation pass (the ownership flow itself is
  fully tracked).
```
