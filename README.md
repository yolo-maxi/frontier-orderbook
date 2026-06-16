# Frontier — a thin-tick on-chain CLOB

A standalone on-chain central limit order book where **user-facing ticks
stay thin** (CEX-grade price precision) and **settlement work is
compressed**: taker sweeps cost O(order endpoints crossed), not O(ticks
crossed), so a 5% move through 5,000 active thin levels settles for ~210k
gas (it was 287M — unexecutable — under per-level settlement).

**Live demo: https://clob.repo.box** — ETH-USDC book on a public devnet
(RPC `https://rpc-clob.repo.box`, chain 84100), market-made around the
live Coinbase ETH price at ±0.1% by bots whose fast-path requotes run
through **delegated operator keys** (selector-scoped permission grants —
no custody).

## What's here

| | |
|---|---|
| `prototype/src/RollingFrontierBook.sol` | **Core**: two-sided book, endpoint-telescoped sweeps, shaped (linear-ladder) orders, O(1) deposit/requote/witness-claims, internal-balance recycling, transferable positions, v4-style hooks, delegatable permissions |
| `prototype/src/FrontierBookFactory.sol` | Ephemeral markets: any pair, any tick spacing, many books in parallel |
| `prototype/src/periphery/` | **Periphery**: `FrontierRouter` (Uniswap-v2-shaped `swapExactTokensForTokens` for aggregators), `FrontierLens` (depth + to-the-wei quotes), `FrontierMakerKit` (whole quoting curves in one tx), `RangeLP` (Uniswap-style passive LP vaults on the book) |
| `prototype/src/permissions/` | ERC Approval Registry (delegatable, selector-scoped, expirable permissions) |
| `prototype/src/hooks/` | v4-style hooks: permissions in the hook address bits, selector-return validation |
| `bots/` | MM bot (±0.1% around live spot, operator-key requotes) + taker flow bot |
| `ui/` | The trading UI served at clob.repo.box |

## The four ideas underneath

1. **Rolling frontier**: an order is two ledger deltas; fills consume the
   aggregate frontier and roll it — no per-user work in swaps, O(1)
   deposits at any width, no resurrection by construction.
2. **Prefix-contiguity**: a valid order's fills are always a contiguous
   prefix of its range, so claims verify against one high-water mark in
   O(log) — no per-tick clocks, fragmentation-proof.
3. **Endpoint telescoping**: between order endpoints the ladder is affine;
   whole runs settle via closed-form series. Tick fineness is free.
4. **Everything is delegatable**: every owner gate consults a shared
   permission registry; bots manage, owners receive.

## Docs

- `prototype/README.md` — prototype map + headline results (156 tests)
- `prototype/DESIGN.md` / `IMPLEMENTATION.md` / `TESTING.md` — why / how / proof
- `prototype/PRICING.md` — ticks ↔ prices for ETH/USDC and BTC/USDC
- `prototype/EXPERIMENTS.md` — yield-while-quoted, hooks, LP-on-book
- `prototype/DEPLOYMENT.md` — devnet runbook + Base Sepolia (needs funded key)
- `requirements.md`, `invariants.md`, `test-plan.md`, `accounting-scenarios.md` — the original spec package this grew from
- The fill-clock bucket book + real Uniswap v4 hook variant (Base-mainnet-fork validated) remain in `prototype/src/` as the v4-compatible lineage

## Run

```sh
cd prototype && forge test                 # 156 tests (no network)
FORK=true forge test --match-contract Fork # Base mainnet fork suite
./deploy-devnet.sh                         # deploy the full demo stack
```
