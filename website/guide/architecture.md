# Architecture

Uniswap-shaped: a minimal core that owns funds and invariants, expressive
periphery around it, and a factory that makes markets ephemeral.

## Core

| Contract | Role |
|---|---|
| `FrontierBookBase` | Shared storage layout, frontier ledgers, and curve virtuals — everything both halves of the book need to agree on |
| `UniformFrontierBook` | The hot half: deposits, endpoint-telescoped sweeps, claims, uniform ask ladders (no shaped orders, no internal-balance recycling), hooks + permission gates. The base that `GeometricFrontierBook` extends |
| `UniformMakerOps` | The cold half: requotes, cancels, position transfers — executed via delegatecall against the book's storage so the pair clears EIP-170 instead of shipping a monolith. One module is memoized per (pair, spacing, hooks) config and shared by every matching book |
| `GeometricFrontierBook` | The production book: the `1.0001^tick` curve as a mixin over `UniformFrontierBook` (`GeometricMakerOps` is its cold half); uniform runs telescope to one pow per endpoint |
| `FrontierGeoBookFactory` | The deploy-day (and test) geometric factory: creates geometric books for any pair at any tick spacing via embedded one-initcode deployers (`FrontierDeployers`); many books per pair can run in parallel; tracks the canonical book per pair for router path lookups; binds the shared permission registry and optional hooks |
| `PermissionRegistry` | The delegatable-permissions registry (a standalone draft ERC) |

Books hold no protocol-wide state: launch one, use it, abandon it. A book
deploys for ~9M gas at max runtime optimization (cheaper at deploy-tuned
settings), and the maker-ops module is shared, so markets stay disposable.

## Periphery

| Contract | Role |
|---|---|
| `FrontierRouter` | Taker entry. **Aggregator-compatible**: Uniswap-v2-shaped `swapExactTokensForTokens(amountIn, amountOutMin, path, to, deadline)` resolves the pair's canonical book and maps exact-input semantics onto budgeted sweeps (spend up to amountIn, park at the exact affordable tick, refund the rest). Explicit `buyExactIn`/`sellExactIn` for direct integration. |
| `FrontierLens` | Read-only. Book depth reconstruction for UIs, best bid/ask summary, and **execution-exact quotes** (`quoteBuy`/`quoteSell` replay the sweep math including mid-run budget subdivision — quote == execution to the wei, asserted in tests). |
| `FrontierMakerKit` | Places a whole quoting curve as uniform ladder segments — near, flat, and bid segments — in one transaction, then hands ownership of every position to the caller. |
| `RangeLP` / `RangeLPFactory` | Uniswap-style passive LP vaults on the book ([experiment](/experiments/lp)). |
| `FrontierPositionNFT` | ERC-721 wrapper over book positions: mint-and-deposit in one call, or adopt an existing position via a one-time registry grant. |
| `YieldRangeLP` | Personal market-making vault whose idle inventory earns lending yield in 4626-style vaults, pulled back just-in-time on rebalance; exits in kind if a vault freezes. |

## Where management lives

Positions are managed on the **core** directly (requote/claim/cancel are
already O(1) there); the periphery never custodies positions. Anything an
owner can do, a registry-authorized operator can do — see
[Delegatable Permissions](/guide/permissions).
