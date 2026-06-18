# Frontier docs

Documentation and AI-readiness layer for **Frontier**, a thin-tick on-chain CLOB
+ prediction-market venue. Live demo: https://clob.repo.box

This directory is the deploy-facing source of truth for agents, integrators, and
tooling. It mirrors the bar set by venues like Uniswap: reference docs + a typed
TypeScript SDK + an MCP server + a packaged agent skill.

## Start here

| If you want to… | Read |
| --- | --- |
| Go from zero to a first trade or quote | [`getting-started.md`](./getting-started.md) |
| Understand the whole system | [`../README.md`](../README.md), [`../requirements.md`](../requirements.md), [`../invariants.md`](../invariants.md) |
| Route an intent to a contract call | [`agent-decision-tree.md`](./agent-decision-tree.md) |
| Look up an exact method / event / revert | [`contract-interface-reference.md`](./contract-interface-reference.md) |
| Deploy a market | [`frontier-abi-interface.md`](./frontier-abi-interface.md), [`../skill.md`](../skill.md) |
| Operate as a market creator / maker / taker agent | [`../skill.md`](../skill.md), [`../skill/`](../skill) |
| Build software against Frontier | [`../sdk/`](../sdk) |
| Wire Frontier into an MCP client | [`../mcp/`](../mcp) |
| Query indexed markets/positions/trades | [`indexer-api.md`](./indexer-api.md), [`../indexer/openapi.yaml`](../indexer/openapi.yaml) |

## Documents in this directory

### Start here

- **[`getting-started.md`](./getting-started.md)** — the shortest path from
  "what is it" to a first trade, quote, SDK call, or indexer query, with the
  core model (`token0`/`token1`, ranges, the geometric grid, prediction markets
  as YES/collateral books).

### Reference

- **[`contract-interface-reference.md`](./contract-interface-reference.md)** —
  OpenRPC-style reference for the five core contracts: every read and write
  method, events, revert conditions, and examples. Covers the lens snapshot
  surface (`positionView`/`positionViews`/`positionsOf`, `bestPrices`) and the
  on-chain frontier + keeper helpers (`frontierOf`/`bidFrontierOf`,
  `claimAuto`/`claimBidAuto`).
- **[`indexer-api.md`](./indexer-api.md)** — the indexer's REST + WebSocket read
  API, backed by [`../indexer/openapi.yaml`](../indexer/openapi.yaml).
- **[`frontier-abi-interface.md`](./frontier-abi-interface.md)** — compact ABI
  map and deploy-script reference.
- **[`agent-decision-tree.md`](./agent-decision-tree.md)** — intent → contract
  path, with the guardrails an agent must apply on every write.

### Machine-readable schemas (JSON Schema 2020-12)

- **[`deployment-schema.json`](./deployment-schema.json)** — shape of a deployed
  Frontier venue (addresses, tokens, spacing, fees, smoke-test results).
- **[`position-schema.json`](./position-schema.json)** — normalized position
  record plus live entitlements.

Both validate clean under an AJV 2020-12 validator and ship worked `examples`.

## The contract surface at a glance

| Contract | Role |
| --- | --- |
| `FrontierGeoBookFactory` | Create and look up geometric books |
| `GeometricFrontierBook` | The market book: maker (ask/bid), taker, position management |
| `FrontierRouter` | Exact-input taker periphery (default user swap path) |
| `FrontierLens` | Read-only quotes, depth, and summaries |
| `PermissionRegistry` | Selector-scoped, expirable delegation for bots |

Generated ABIs live in [`../abi/*.json`](../abi) and are re-exported as typed
`as const` objects from [`@frontier/sdk`](../sdk).

## Conventions used across all docs

- `token0` = base asset (sold by asks, bought by bids); `token1` = quote asset.
- Positions cover a half-open range `[lower, upper)`, ticks aligned to
  `tickSpacing`. Asks rest above `currentTick`; bids rest at/below it.
- Prices follow the geometric curve `1.0001^tick`.
- Token amounts in JSON are decimal strings of the underlying `uint256`.
- The deployed book is **uniform-only** (one size per level); the shaped-ladder
  surface exists only on the `archive/rolling-frontier-book` branch.

## AI-readiness map

```
docs/                         human + machine reference (this directory)
  getting-started.md
  contract-interface-reference.md
  indexer-api.md
  agent-decision-tree.md
  deployment-schema.json
  position-schema.json
../skill.md                   canonical agent operating guide (prose)
../skill/                     packaged Claude Agent Skill (SKILL.md + references)
../sdk/                       @frontier/sdk — typed wrappers + agent helpers
../mcp/                       @frontier/mcp — MCP tools (describe + simulate + execute)
../indexer/                   REST/WebSocket API over indexed on-chain state
```
