# @frontier/mcp

A [Model Context Protocol](https://modelcontextprotocol.io) server that exposes
the **Frontier** on-chain order-book venue to AI agents and MCP clients (Claude
Desktop, Claude Code, etc.).

It wraps [`@frontier/sdk`](../sdk) and ships **16 tools** across five categories:
lens/read, market, maker, taker, and position/delegation. Every write tool
**dry-runs by default** — it validates inputs, simulates the call via
`eth_call`, and returns the encoded calldata. To actually broadcast you must
both pass `execute: true` **and** opt in at the process level via
`FRONTIER_MCP_ALLOW_EXECUTE=1` with a configured wallet; otherwise execution is
refused and the calldata/simulation is returned (see [Safety model](#safety-model)).

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
| `FRONTIER_PRIVATE_KEY` | optional | Wallet that *can* sign. Required for execution, but not sufficient on its own — see `FRONTIER_MCP_ALLOW_EXECUTE`. Without it, write tools dry-run and return calldata only. |
| `FRONTIER_MCP_ALLOW_EXECUTE` | optional | **Execution kill-switch (off by default).** Must be `1`/`true` to allow `execute: true` to broadcast. With it unset, `execute: true` is refused and the server returns the simulation/calldata instead. |

`FRONTIER_RPC_URL` is validated at startup: it must be an absolute `http(s)`
URL. The raw URL is never echoed in error messages, so credentials embedded in
the endpoint (API keys / basic-auth) are not logged.

Addresses configured here are defaults; every tool also accepts the relevant
address as an argument so one server can talk to multiple books.

## Safety model

- **Dry-run first.** Write tools simulate before sending; the result includes
  the decoded simulation return, the `calldata`, and whether a wallet can
  execute.
- **Safe-by-default execution.** `execute: true` only broadcasts when **both**
  `FRONTIER_MCP_ALLOW_EXECUTE=1` is set **and** a wallet
  (`FRONTIER_PRIVATE_KEY`) is configured. If either is missing, the call is
  **refused**: the server falls back to the simulation/calldata path and returns
  a `refused` message explaining how to enable execution (set the flag and/or
  configure a wallet, or sign the returned calldata elsewhere). This applies
  consistently to every execute-capable tool (`frontier_market_create`,
  `frontier_maker_*`, `frontier_taker_*`, `frontier_position_transfer`,
  `frontier_delegation_grant`).
- **No key, no broadcast.** With no `FRONTIER_PRIVATE_KEY`, the server is
  read-and-simulate only and emits calldata for you to sign elsewhere.
- **Client-side validation** mirrors the contracts: token/fee/spacing checks for
  market creation, range/side/alignment checks for maker orders, and
  quote+slippage for taker swaps.

### Enabling execution

```sh
# Dry-run only (default) — safe even with a key present:
FRONTIER_RPC_URL=https://... FRONTIER_PRIVATE_KEY=0x... node dist/server.js

# Allow real broadcasts (explicit opt-in + wallet):
FRONTIER_RPC_URL=https://... \
FRONTIER_PRIVATE_KEY=0x... \
FRONTIER_MCP_ALLOW_EXECUTE=1 \
node dist/server.js
```

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
