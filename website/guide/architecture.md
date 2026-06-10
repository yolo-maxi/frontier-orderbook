# Architecture

Uniswap-shaped: a minimal core that owns funds and invariants, expressive
periphery around it, and a factory that makes markets ephemeral.

## Core

| Contract | Role |
|---|---|
| `RollingFrontierBook` | The book: two-sided frontier ledgers, endpoint-telescoped sweeps, shaped orders, internal balances, transferable positions, hooks + permission gates |
| `FrontierBookFactory` | Creates books for any pair at any tick spacing; many books per pair can run in parallel; tracks the canonical book per pair for router path lookups; binds the shared permission registry and optional hooks |
| `PermissionRegistry` | The delegatable-permissions registry (a standalone draft ERC) |

Books hold no protocol-wide state: launch one, use it, abandon it.
Deployment is ~cheap enough (couple million gas) for markets to be
disposable.

## Periphery

| Contract | Role |
|---|---|
| `FrontierRouter` | Taker entry. **Aggregator-compatible**: Uniswap-v2-shaped `swapExactTokensForTokens(amountIn, amountOutMin, path, to, deadline)` resolves the pair's canonical book and maps exact-input semantics onto budgeted sweeps (spend up to amountIn, park at the exact affordable tick, refund the rest). Explicit `buyExactIn`/`sellExactIn` for direct integration. |
| `FrontierLens` | Read-only. Book depth reconstruction for UIs, best bid/ask summary, and **execution-exact quotes** (`quoteBuy`/`quoteSell` replay the sweep math including mid-run budget subdivision — quote == execution to the wei, asserted in tests). |
| `FrontierMakerKit` | Places a whole piecewise-linear quoting curve — shaped, flat, and bid segments — in one transaction, then hands ownership of every position to the caller. |
| `RangeLP` / `RangeLPFactory` | Uniswap-style passive LP vaults on the book ([experiment](/experiments/lp)). |

## Where management lives

Positions are managed on the **core** directly (requote/claim/cancel are
already O(1) there); the periphery never custodies positions. Anything an
owner can do, a registry-authorized operator can do — see
[Delegatable Permissions](/guide/permissions).
