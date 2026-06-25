# Architecture

Uniswap-shaped: a minimal core that owns funds and invariants, expressive
periphery around it, and a factory that makes markets ephemeral.

## Core

| Contract | Role |
|---|---|
| `FrontierBookBase` | Shared storage layout, frontier ledgers, and curve virtuals — everything both halves of the book need to agree on |
| `UniformFrontierBook` | The hot half: deposits, endpoint-telescoped sweeps, claims, uniform ask ladders (no shaped orders, no internal-balance recycling), hooks + permission gates. The base that `GeometricFrontierBook` extends |
| `UniformMakerOps` | The cold half for the uniform/linear test book: requotes, cancels, position transfers, and mirror-liquidity deposits/withdrawals — executed via delegatecall against the book's storage |
| `GeometricFrontierBook` | The production book: the `1.0001^tick` curve as a mixin over `UniformFrontierBook` (`GeometricMakerOps` is its cold half); uniform runs telescope to one pow per endpoint |
| `FrontierGeoBookFactory` | The deploy-day (and test) geometric factory: creates geometric books for any pair at any tick spacing through `GeometricBookDeployer` / `GeometricOpsDeployer`; many books per pair can run in parallel; tracks the first/default book per pair for router path lookups; binds the shared permission registry and optional hooks |
| `PermissionRegistry` | The delegatable-permissions registry (a standalone draft ERC) |

Books hold no protocol-wide state: launch one, use it, abandon it. A book
deploys through the factory for 8,811,051 gas in the current isolated
benchmark, and the maker-ops module is memoized per immutable config
(token pair, spacing, hooks, fee recipient, maker bps, taker bps). Under
the default runtime-gas optimizer the main book is too large for EIP-170;
under `FOUNDRY_PROFILE=deploy`, `GeometricFrontierBook` is 22,120 bytes
and `GeometricMakerOps` is 11,596 bytes.

## Periphery

| Contract | Role |
|---|---|
| `FrontierRouter` | Taker entry. **Aggregator-compatible**: Uniswap-v2-shaped `swapExactTokensForTokens(amountIn, amountOutMin, path, to, deadline)` resolves the pair's canonical book and maps exact-input semantics onto budgeted sweeps (spend up to amountIn, park at the exact affordable tick, refund the rest). Explicit `buyExactIn`/`sellExactIn` for direct integration. |
| `FrontierLens` | Read-only. Book depth reconstruction for UIs, best bid/ask summary, and **execution-exact quotes** (`quoteBuy`/`quoteSell` replay the sweep math including mid-run budget subdivision — quote == execution to the wei, asserted in tests). One-call snapshots: `bestPrices` (inside market with sizes + rates + spread) and `positionView`/`positionViews`/`positionsOf` (a position fully resolved — frontier, claimable, unfilled — so a dashboard reads it in one round trip). |
| `FrontierMakerKit` | Places a whole quoting curve as uniform ladder segments — near, flat, and bid segments — in one transaction, then hands ownership of every position to the caller. |
| `RangeLP` / `RangeLPFactory` | Uniswap-style passive LP vaults on the book ([experiment](/experiments/lp)). |
| `FrontierPositionNFT` | ERC-721 wrapper over book positions: mint-and-deposit in one call, or adopt an existing position via a one-time registry grant. |
| `YieldRangeLP` / `YieldRangeLPFactory` | Personal market-making vault whose idle inventory earns lending yield in 4626-style vaults, pulled back just-in-time on rebalance; exits in kind if a vault freezes. |

## Where management lives

Positions are managed on the **core** directly (requote/claim/cancel are
already O(1) there); the periphery never custodies positions. Anything an
owner can do, a registry-authorized operator can do — see
[Delegatable Permissions](/guide/permissions).

A position's fill state is on-chain too: `frontierOf`/`bidFrontierOf` return
the live frontier a claim would settle to, so integrators no longer
reconstruct a boundary witness off-chain. For automation, `claimAuto`/
`claimBidAuto` settle to that frontier and revert cheaply below a `minProceeds`
floor — proceeds always pay the owner, never the operator — which kills the
keeper's "is this tx worth it?" race.

Fees are immutable per book: `makerFeeBps` is charged from maker claim
proceeds, `takerFeeBps` is charged on sweep input, both are capped at
1,000 bps, and the deploy script defaults both to zero.

## Reading the venue off-chain

Three layers, generated from the same ABIs so they never drift. The
[**SDK**](/guide/build) wraps every contract with typed viem clients plus
maker/taker/creator agents; the [**MCP server**](/guide/build) exposes the same
surface to AI agents with simulate-before-execute; the
[**indexer**](/guide/build) watches events once and serves markets, positions,
the trade tape, stats, candles, and depth over REST + WebSocket — the
unbounded-history companion to the lens's point-in-time reads.
