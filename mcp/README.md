# @frontier/mcp

A [Model Context Protocol](https://modelcontextprotocol.io) server that exposes
the **Frontier** on-chain order-book venue to AI agents and MCP clients (Claude
Desktop, Claude Code, etc.).

It wraps [`@frontier/sdk`](../sdk) and ships **16 tools** across five categories:
lens/read, market, maker, taker, and position/delegation. Every write tool
**dry-runs by default** — it validates inputs, simulates the call via
`eth_call`, and returns the encoded calldata. Pass `execute: true` (with a
configured wallet) to broadcast.

## Tools

| Tool | Write | Purpose |
| --- | --- | --- |
| `frontier_book_config` | no | Book tokens, spacing, current tick, fees, hooks, permissions |
| `frontier_lens_summary` | no | Current tick, spacing, tokens, best ask/bid |
| `frontier_lens_depth` | no | Aggregated bid/ask depth between two ticks |
| `frontier_quote` | no | Quote a buy/sell before trading |
| `frontier_market_find` | no | Look up existing books for a pair |
| `frontier_market_create` | yes | Create a geometric market (validated + simulated) |
| `frontier_maker_deposit` | yes | Place an ask/bid (range + side validated) |
| `frontier_maker_claim` | yes | Claim net proceeds |
| `frontier_maker_cancel` | yes | Cancel; returns proceeds + principal/refund |
| `frontier_maker_requote` | yes | Move/resize a live position |
| `frontier_taker_swap` | yes | Router exact-in swap with quote + slippage |
| `frontier_taker_sweep` | yes | Advanced direct sweep with explicit limits |
| `frontier_position_get` | no | Read a position + live entitlements |
| `frontier_position_transfer` | yes | Transfer position ownership |
| `frontier_delegation_grant` | yes | Grant selector-scoped delegation (optional expiry) |
| `frontier_delegation_check` | no | Check operator authorization for a selector |

## Configuration

The server is configured entirely through environment variables:

| Var | Required | Notes |
| --- | --- | --- |
| `FRONTIER_RPC_URL` | yes | JSON-RPC endpoint |
| `FRONTIER_CHAIN_ID` | recommended | Chain id |
| `FRONTIER_FACTORY` | optional | Default `FrontierGeoBookFactory` |
| `FRONTIER_ROUTER` | optional | Default `FrontierRouter` |
| `FRONTIER_LENS` | optional | Default `FrontierLens` |
| `FRONTIER_REGISTRY` | optional | Default `PermissionRegistry` |
| `FRONTIER_BOOK` | optional | Default `GeometricFrontierBook` |
| `FRONTIER_PRIVATE_KEY` | optional | Enables `execute: true`. Without it, write tools dry-run and return calldata only. |

Addresses configured here are defaults; every tool also accepts the relevant
address as an argument so one server can talk to multiple books.

## Safety model

- **Dry-run first.** Write tools simulate before sending; the result includes
  the decoded simulation return, the `calldata`, and whether a wallet can
  execute.
- **No key, no broadcast.** With no `FRONTIER_PRIVATE_KEY`, the server is
  read-and-simulate only and emits calldata for you to sign elsewhere.
- **Client-side validation** mirrors the contracts: token/fee/spacing checks for
  market creation, range/side/alignment checks for maker orders, and
  quote+slippage for taker swaps.

## Run

```sh
pnpm install      # links @frontier/sdk via file:../sdk
pnpm build
FRONTIER_RPC_URL=https://... \
FRONTIER_FACTORY=0x... FRONTIER_ROUTER=0x... FRONTIER_LENS=0x... \
FRONTIER_REGISTRY=0x... FRONTIER_BOOK=0x... \
node dist/server.js
```

> Build `@frontier/sdk` first (`cd ../sdk && pnpm install && pnpm build`) so the
> `file:` link resolves its `dist/`.

### Claude Desktop / Claude Code config

```json
{
  "mcpServers": {
    "frontier": {
      "command": "node",
      "args": ["/abs/path/to/mcp/dist/server.js"],
      "env": {
        "FRONTIER_RPC_URL": "https://...",
        "FRONTIER_CHAIN_ID": "8453",
        "FRONTIER_FACTORY": "0x...",
        "FRONTIER_ROUTER": "0x...",
        "FRONTIER_LENS": "0x...",
        "FRONTIER_REGISTRY": "0x...",
        "FRONTIER_BOOK": "0x..."
      }
    }
  }
}
```

Add `FRONTIER_PRIVATE_KEY` only when you want the agent to broadcast
transactions. Treat that key as hot-wallet material.

## Typecheck / build

```sh
pnpm exec tsc --noEmit
pnpm build
```

The workspace is self-rooted (`pnpm-workspace.yaml`).
