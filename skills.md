# Frontier agent skill

Use this skill when an agent needs to quote, trade, make markets, manage positions, or deploy against the Frontier order book.

## Current deployment stance

Use current `main` as the deployable path.

- Deploy `GeometricFrontierBook` through `FrontierBookFactory.createGeoBook(...)` for real markets.
- Do not use the singleton/global-credit prototype for today's deployment.
- Do not rely on demo mock-token deployment scripts for production without parameterizing them.
- Treat the book as a standalone Frontier venue, not as a Uniswap v4 hook pool.

Primary docs and ABI files:

- Human ABI guide: `docs/frontier-abi-interface.md`
- JSON ABIs: `abi/*.json`
- Solidity source: `prototype/src/`
- Tests: `prototype/test/`

## Contract roles

- `FrontierBookFactory`: creates books.
- `GeometricFrontierBook`: production-candidate book.
- `RollingFrontierBook`: linear/demo book; same main user ABI.
- `FrontierRouter`: simple exact-input taker router.
- `FrontierLens`: quotes, depth, summary, curve detection.
- `PermissionRegistry`: lets humans authorize bot delegates.

## Before any action

- Use explicit deployed addresses for `book`, `router`, and `lens`.
- Confirm token order:
  - `token0` = base asset.
  - `token1` = quote asset.
- Confirm `tickSpacing` and `currentTick()`.
- Confirm all ticks are aligned to spacing.
- Quote with `FrontierLens` before any taker transaction.
- Use a deadline and slippage protection.
- Never call unbounded/unsafe paths for user funds.

## Maker: place asks

Asks sell token0 above current price.

Flow:

1. Read `currentTick()` and `tickSpacing()` from the book.
2. Choose `[lower, upper)` above current tick.
3. Approve token0 to the book.
4. Call one of:
   - `deposit(lower, upper, liquidity)` for flat asks.
   - `depositShaped(lower, upper, liquidity, slope)` for shaped asks.
5. Store the returned `positionId`.

Rules:

- `lower < upper`.
- `lower` and `upper` must be aligned.
- Every shaped level must be positive.
- Position owner is the caller unless using wrapper/periphery that transfers ownership back.

## Maker: place bids

Bids buy token0 with token1 below or at current price.

Flow:

1. Read `currentTick()` and `tickSpacing()`.
2. Choose `[lower, upper)` with `upper <= currentTick()`.
3. Approve token1 to the book unless enough `internalBalance1` exists.
4. Call `depositBid(lower, upper, liquidity)`.
5. Store the returned `positionId`.

## Maker: claim, cancel, recycle

Ask positions:

- `claim(positionId)` claims filled token1 to wallet.
- `claimInternal(positionId)` claims filled token1 to book internal credit.
- `cancel(positionId)` claims filled token1 and returns unfilled token0.
- `claimTo(positionId, target)` and `cancelWithWitness(positionId, frontier)` are cheaper when the agent has a valid witness.

Bid positions:

- `claimBid(positionId)` claims filled token0 to wallet.
- `claimBidInternal(positionId)` claims filled token0 to book internal credit.
- `cancelBid(positionId)` claims filled token0 and refunds unfilled token1.
- `claimBidTo(positionId, target)` and `cancelBidWithWitness(positionId, frontier)` are cheaper with a valid witness.

Recycle paths:

- `recycleBidIntoAsk(...)` converts internally-claimed bid fills into a new ask.
- `recycleAskIntoBid(...)` converts internally-claimed ask fills into a new bid.
- `withdrawInternal(amount0, amount1)` withdraws internal credits back to wallet.

Agent preference:

- Active market makers should use internal claim/recycle paths.
- Withdraw only when inventory should leave the book.

## Taker: quote and swap

Buy token0 with token1:

1. Call `lens.quoteBuy(book, amount1In)`.
2. Set `minOut0` from the quote and slippage policy.
3. Approve token1 to the router.
4. Call `router.buyExactIn(book, amount1In, minOut0, recipient, deadline)`.

Sell token0 for token1:

1. Call `lens.quoteSell(book, amount0In, maxRuns)`.
2. Set `minOut1` from the quote and slippage policy.
3. Approve token0 to the router.
4. Call `router.sellExactIn(book, amount0In, minOut1, recipient, deadline)`.

Advanced direct route:

- Call `book.sweepWithLimits(target, maxFills, maxPay, minOut, deadline)` only when the agent deliberately controls target tick and fill budget.
- Do not use `sweep(...)` or `moveTickTo(...)` for user-facing swaps.

## Position delegation

If an agent manages a human maker's positions:

1. Human grants the agent selector-scoped permissions on the book, for example `grant(agent, book, RollingFrontierBook.claim.selector)`, or uses `grantSelectorBundle(...)` for several selectors.
2. For trusted automation only, human may call `grantFull(agent, book)`.
3. Agent can then manage positions owned by the human using the authorized book functions.
4. Agent should never assume approval; check `isAuthorizedCall(owner, agent, book, selector)` first.

## Safety rules

- Quote before swap.
- Use `minOut` and `deadline`.
- Keep `maxFills` bounded.
- Do not rely on factory `defaultBook` if multiple books exist for a token pair.
- Do not deploy hooks unless audited.
- Do not use singleton/global-credit branch for production.
- Do not change storage layout around `FrontierBookBase` / `FrontierMakerOps` without a dedicated storage-layout review.
- Do not assume support for weird ERC20s with fees, rebases, missing returns, or non-standard approvals.

## Rough edges agents must understand

- Internal balances are per-book only.
- Router has a fixed sweep window; big trades may need direct or repeated calls.
- Lens depth is bounded by the requested window and max levels.
- The deployment script in `prototype/script/DeployDemo.s.sol` is a demo script; production deployment needs explicit real token/config inputs.
- The geometric path is the intended real path; the linear path is mostly for tests and demos.

## Minimal deploy-day checklist for agents

- Build: `cd prototype && forge build`
- Full tests: `cd prototype && forge test`
- Gas sanity: `cd prototype && forge test --match-path 'test/*Gas*.t.sol' --isolate -vv --gas-report`
- Dry-run deployment with target RPC and real args.
- Save deployed addresses in a chain-specific JSON file.
- Smoke test:
  - create geometric book
  - place one tiny ask
  - place one tiny bid
  - quote buy/sell through lens
  - execute one tiny router buy or sell
  - claim/cancel the test position if appropriate
