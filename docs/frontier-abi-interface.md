# Frontier deploy ABI interface

This is the deploy-facing ABI guide for the current `main` Frontier book.

Status: production-candidate prototype for a standalone Frontier order-book venue. Use the geometric book for real deployments unless you intentionally want the linear demo curve.

## Canonical contracts

- `FrontierBookFactory`
  - Deploys books and memoizes the maker-ops companion contracts.
  - Use `createGeoBook(...)` for the production curve.
  - Use `createBook(...)` only for the linear/demo curve.

- `GeometricFrontierBook`
  - Production-candidate order book using the geometric `1.0001^tick` curve.
  - Same core user ABI as `RollingFrontierBook`.

- `RollingFrontierBook`
  - Linear/demo curve order book.
  - Useful for tests, local demos, and simpler reasoning.

- `FrontierRouter`
  - V2-style exact-input taker periphery.
  - Supports direct book calls and simple token path calls through the factory default book.

- `FrontierLens`
  - Read-only quotes, depth, summary, and curve detection.
  - Agents should quote through the lens before submitting swaps.

- `PermissionRegistry`
  - Delegation layer for bots/agents managing a maker's positions.

Generated JSON ABIs are in `abi/` at the repo root:

- `abi/FrontierBookFactory.json`
- `abi/GeometricFrontierBook.json`
- `abi/RollingFrontierBook.json`
- `abi/FrontierRouter.json`
- `abi/FrontierLens.json`
- `abi/PermissionRegistry.json`

## Real-token deploy script

Use `prototype/script/DeployFrontier.s.sol` for today's deploy. Required env vars:

- `DEPLOYER_KEY`
- `TOKEN0`
- `TOKEN1`
- `TICK_SPACING`
- `START_TICK`

Optional env vars:

- `DEPLOY_NAME`
- `DEPLOY_OUT`

Example:

```bash
cd prototype
DEPLOYER_KEY=... TOKEN0=0x... TOKEN1=0x... TICK_SPACING=60 START_TICK=0 \
forge script script/DeployFrontier.s.sol:DeployFrontier --rpc-url "$RPC_URL" --broadcast --verify
```

The script deploys registry, factory, lens, router, and one geometric book, then writes a deployment JSON.

## Deploy sequence

Deploy these contracts first:

- `PermissionRegistry`
- `RollingBookDeployer`
- `MakerOpsDeployer`
- `GeometricBookDeployer`
- `GeometricOpsDeployer`
- `FrontierBookFactory(registry, rollingDeployer, makerOpsDeployer, geoBookDeployer, geoOpsDeployer)`
- `FrontierLens`
- `FrontierRouter(factory, lens)`

Then create the market book:

```solidity
address book = factory.createGeoBook(token0, token1, tickSpacing, startTick);
```

Use `createGeoBookWithHooks(...)` only if the hooks contract is final and its address has the correct low-bit hook flags.

## Tick and asset conventions

- `token0` is the base asset sold by asks and bought by bids.
- `token1` is the quote asset paid by ask takers and deposited by bid makers.
- Ticks are aligned to `tickSpacing`.
- Ask ranges are `[lower, upper)` above the current tick.
- Bid ranges are `[lower, upper)` at or below the current tick.
- For geometric books, price follows the geometric curve implemented by `GeoTickMath`.

## Maker ABI: asks

Sell token0 across a range above current price.

```solidity
function deposit(int24 lower, int24 upper, uint128 liquidity) returns (uint256 positionId);
function depositShaped(int24 lower, int24 upper, uint128 liquidity, int128 slope) returns (uint256 positionId);
```

Before calling:

- Approve token0 to the book.
- Ensure `lower < upper`.
- Ensure both ticks are aligned.
- Ensure the range is above the current tick.
- For shaped orders, each covered level must remain positive.

Useful follow-ups:

```solidity
function claim(uint256 positionId) returns (uint256 proceeds1);
function claimTo(uint256 positionId, int24 target) returns (uint256 proceeds1);
function claimInternal(uint256 positionId) returns (uint256 proceeds1);
function cancel(uint256 positionId) returns (uint256 proceeds1, uint256 principal0);
function cancelWithWitness(uint256 positionId, int24 frontier) returns (uint256 proceeds1, uint256 principal0);
```

Use `claimTo` or `cancelWithWitness` when the agent can compute a valid frontier witness. Otherwise use `claim`/`cancel` and let the book binary-search.

## Maker ABI: bids

Buy token0 with token1 below or at current price.

```solidity
function depositBid(int24 lower, int24 upper, uint128 liquidity) returns (uint256 positionId);
```

Before calling:

- Approve token1 to the book unless using existing internal token1 credit.
- Ensure `lower < upper`.
- Ensure both ticks are aligned.
- Ensure `upper <= currentTick()`.

Useful follow-ups:

```solidity
function claimBid(uint256 positionId) returns (uint256 proceeds0);
function claimBidTo(uint256 positionId, int24 target) returns (uint256 proceeds0);
function claimBidInternal(uint256 positionId) returns (uint256 proceeds0);
function cancelBid(uint256 positionId) returns (uint256 proceeds0, uint256 refund1);
function cancelBidWithWitness(uint256 positionId, int24 frontier) returns (uint256 proceeds0, uint256 refund1);
```

## Internal credit ABI

Internal credits are per-book, not global across books.

```solidity
function internalBalance0(address user) view returns (uint256);
function internalBalance1(address user) view returns (uint256);
function withdrawInternal(uint256 amount0, uint256 amount1);
function recycleBidIntoAsk(uint256 bidId, int24 lower, int24 upper, uint128 liquidity, int128 slope) returns (uint256 newPositionId);
function recycleAskIntoBid(uint256 askId, int24 lower, int24 upper, uint128 liquidity) returns (uint256 newPositionId);
```

Use internal claims/recycling for active makers because it avoids wallet round-trips. Withdraw only when the maker wants funds back in the wallet.

## Position management ABI

```solidity
function positions(uint256 positionId) view returns (
  address owner,
  int24 lower,
  int24 upper,
  uint128 liquidity,
  uint64 depositClock,
  int24 claimedUpper,
  bool live,
  bool isBid
);

function transferPosition(uint256 positionId, address to);
function requote(uint256 positionId, int24 newLower, int24 newUpper, uint128 newLiquidity);
function requoteShaped(uint256 positionId, int24 newLower, int24 newUpper, uint128 newLiquidity, int128 newSlope);
function requoteBid(uint256 positionId, int24 newLower, int24 newUpper, uint128 newLiquidity);
```

Requotes and transfers require the position owner or an authorized delegate in `PermissionRegistry`.

## Taker ABI: direct book

Direct book taker path:

```solidity
function sweepWithLimits(
  int24 target,
  uint256 maxFills,
  uint256 maxPay,
  uint256 minOut,
  uint256 deadline
) returns (int24 reached, uint256 paid, uint256 received);
```

Direction rules:

- If `target > currentTick`, the taker buys token0 from asks and pays token1.
- If `target < currentTick`, the taker sells token0 into bids and receives token1.
- Approve the input token to the book before calling.
- Always set `maxPay`, `minOut`, and `deadline`.
- Avoid `sweep(...)` and `moveTickTo(...)` in production taker agents unless explicitly simulating/admin-testing. They have weak user protection.

## Taker ABI: router

```solidity
function buyExactIn(address book, uint256 amount1In, uint256 minOut0, address to, uint256 deadline) returns (uint256 paid1, uint256 received0);
function sellExactIn(address book, uint256 amount0In, uint256 minOut1, address to, uint256 deadline) returns (uint256 paid0, uint256 received1);
function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline) returns (uint256[] memory amounts);
function getAmountsOut(uint256 amountIn, address[] path) view returns (uint256[] memory amounts);
```

For router calls, approve the input token to the router. The router handles book approval and refunds unspent input.

## Lens ABI

```solidity
function summary(RollingFrontierBook book, int24 scanWindow) view returns (BookSummary memory);
function depth(RollingFrontierBook book, int24 fromTick, int24 toTick, uint256 maxLevels) view returns (Level[] memory);
function quoteBuy(RollingFrontierBook book, uint256 amount1In) view returns (uint256 amount0Out, uint256 amount1Spent, int24 endTick);
function quoteSell(RollingFrontierBook book, uint256 amount0In, uint256 maxRuns) view returns (uint256 amount1Out, uint256 amount0Spent, int24 endTick);
function curveOf(RollingFrontierBook book) view returns (Curve memory);
```

Agent rule: quote first through `FrontierLens`, apply slippage, then submit through router or direct book.

## Permission registry ABI

Use this when bots/agents manage maker positions for a human owner. Permissions are scoped to `(user, operator, target, selector)` or to a full target.

```solidity
function grant(address operator, address target, bytes4 selector);
function grantWithExpiry(address operator, address target, bytes4 selector, uint48 expiry);
function revoke(address operator, address target, bytes4 selector);
function grantFull(address operator, address target);
function grantFullWithExpiry(address operator, address target, uint48 expiry);
function revokeAll(address operator, address target);
function grantSelectorBundle(address operator, address target, bytes4[] selectors, uint48 expiry);
function isAuthorizedCall(address user, address operator, address target, bytes4 selector) view returns (bool);
function permissionExpiry(address user, address operator, address target, bytes4 selector) view returns (uint48);
function permissionNonce(address user) view returns (uint256);
```

Authorization model:

- Owner can always manage their own positions.
- Operator/delegate can manage positions only for selectors or targets the owner granted.
- Prefer selector-scoped grants for agents. Use `grantFull` only for trusted automation.
- Delegates cannot withdraw a wallet's ERC20s; they can only call book management functions that the book authorizes.

## Production call recommendations

- Deploy geometric books for real markets.
- Prefer router for simple swaps and direct book calls for advanced market-maker/taker bots.
- Always use lens quotes and slippage checks.
- Always use deadlines.
- Keep `maxFills` bounded for automated takers.
- Use `claimInternal` / `claimBidInternal` / recycle functions for active makers.
- Use witness functions only when the agent has verified the witness using `currentTick`, position data, and fill state.

## Rough edges on current main

- The book is a standalone venue, not a Uniswap v4 hook-backed pool.
- Internal credits are per book, not singleton/global.
- Deployment scripts are demo-oriented and still mint mock tokens. A real deploy script should be parameterized for chain, tokens, spacing, start tick, and optional seeding.
- Geometric book is the real target, but some helper periphery originated around the linear demo path. Use tested geometric paths only.
- The factory default book is first-created per token pair. If multiple books exist for a pair, agents should use explicit book addresses rather than relying on `defaultBook`.
- Router sweep window is fixed. Large trades may need direct `sweepWithLimits` or multiple calls.
- Lens depth scans are bounded and window-based. It is suitable for bots/UIs, not an exhaustive archival index.
- Non-standard ERC20 behavior is not deeply handled beyond boolean-return style expectations.
- Code size is near the EIP-170 boundary; keep deploy pipeline pinned to the tested compiler settings.
- Hooks are powerful and address-flagged. Do not deploy with hooks unless they have been audited.
- Maker-ops uses delegatecall into shared storage. Storage layout changes require explicit review.
- No singleton/global custody on main. That branch exists as a prototype only.

## Finish-before-deploy checklist

Minimum for today:

- Use the parameterized real-token deploy script: `prototype/script/DeployFrontier.s.sol`.
- Run full Foundry tests with the exact compiler/profile used for deploy.
- Dry-run deployment on the target chain RPC with the real constructor args.
- Save deployed addresses and ABIs in a chain-specific deployment JSON.
- Verify contracts on the explorer if supported.
- Create one smoke-test maker order and one small taker swap on the deployed book.
- Point agents at the explicit book/router/lens addresses, not only factory defaults.

Nice but not required for today:

- Add an indexer for order events and position state.
- Add agent-side witness computation helpers.
- Add multi-book routing policy.
- Add global/singleton credits after today’s deployment is stable.
