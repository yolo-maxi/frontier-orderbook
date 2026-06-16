# Frontier deploy ABI interface

This is the deploy-facing ABI guide for the current Frontier standalone order-book venue.

For agent operation examples, use [`../skill.md`](../skill.md). This file is the compact ABI/reference layer.

## Deploy-readiness status

Frontier is ready for a real-token deploy when the deploy script is run with the target chain/token/fee parameters and the post-deploy smoke test passes.

Current deploy target:

- Use `GeometricFrontierBook` for real markets.
- Create books through `FrontierGeoBookFactory.createGeoBookWithFees(...)`.
- Use `FrontierLens` for quotes/depth.
- Use `FrontierRouter` for normal exact-input taker swaps.
- Use `PermissionRegistry` for selector-scoped maker-agent delegation.

Not part of the deploy-day path:

- Hook-enabled books.
- Singleton/global credit prototype.
- Referrer-code fee splits.
- Maker rebates/emissions.
- Exotic/non-standard ERC20 support.

## Generated ABIs

Generated JSON ABIs live at the repo root:

- `abi/FrontierGeoBookFactory.json`
- `abi/GeometricFrontierBook.json`
- `abi/FrontierRouter.json`
- `abi/FrontierLens.json`
- `abi/PermissionRegistry.json`

Regenerate after Solidity ABI changes:

```bash
cd prototype
forge build
```

## Real-token deploy script

Use `prototype/script/DeployFrontier.s.sol`.

Required env vars:

- `DEPLOYER_KEY`
- `TOKEN0`
- `TOKEN1`
- `TICK_SPACING`
- `START_TICK`
- `RPC_URL` passed to `forge script --rpc-url`

Optional env vars:

- `DEPLOY_NAME`, defaults to `Frontier`
- `DEPLOY_OUT`, defaults to `deployments/frontier-latest.json`
- `FEE_RECIPIENT`, defaults to deployer
- `MAKER_FEE_BPS`, defaults to `0`
- `TAKER_FEE_BPS`, defaults to `0`

Example:

```bash
cd prototype
DEPLOYER_KEY=... \
TOKEN0=0x... \
TOKEN1=0x... \
TICK_SPACING=60 \
START_TICK=0 \
FEE_RECIPIENT=0x... \
MAKER_FEE_BPS=0 \
TAKER_FEE_BPS=30 \
FOUNDRY_PROFILE=deploy forge script script/DeployFrontier.s.sol:DeployFrontier --rpc-url "$RPC_URL" --broadcast --verify
```

The script deploys registry, deployers, factory, lens, router, and one fee-configured geometric book, then writes deployment JSON.

## Deploy sequence

The script deploys:

- `PermissionRegistry`
- `GeometricBookDeployer`
- `GeometricOpsDeployer`
- `FrontierGeoBookFactory`
- `FrontierLens`
- `FrontierRouter`

Then it creates the market book:

```solidity
address book = factory.createGeoBookWithFees(
    token0,
    token1,
    tickSpacing,
    startTick,
    feeRecipient,
    makerFeeBps,
    takerFeeBps
);
```

Use `createGeoBook(...)` only for zero-fee markets.

Use hook-aware creation functions only after hook-specific review. The deploy script uses the hookless path.

## Factory ABI

```solidity
function createGeoBookWithFees(
    address token0,
    address token1,
    int24 tickSpacing,
    int24 startTick,
    address feeRecipient,
    uint16 makerFeeBps,
    uint16 takerFeeBps
) external returns (address book);

function createGeoBook(address token0, address token1, int24 tickSpacing, int24 startTick)
    external
    returns (address book);

function defaultBook(address token0, address token1) external view returns (address book);
function getBook(address token0, address token1, int24 tickSpacing) external view returns (address book);
function books(uint256 index) external view returns (address book);
function bookCount() external view returns (uint256);
```

Agent rule: after creation, persist the explicit `book` address. Avoid `defaultBook` when multiple books may exist for the same pair.

## Tick and asset conventions

- `token0` is the base asset sold by asks and bought by bids.
- `token1` is the quote asset paid by ask takers and deposited by bid makers.
- Ticks are aligned to `tickSpacing`.
- Ask ranges are `[lower, upper)` above the current tick.
- Bid ranges are `[lower, upper)` at or below the current tick.
- Geometric price follows the curve implemented by `GeoTickMath`.

## Book config and fee views

```solidity
function token0() external view returns (IERC20Minimal);
function token1() external view returns (IERC20Minimal);
function tickSpacing() external view returns (int24);
function currentTick() external view returns (int24);
function hooks() external view returns (IFrontierHooks);
function permissions() external view returns (PermissionRegistry);
function feeRecipient() external view returns (address);
function makerFeeBps() external view returns (uint16);
function takerFeeBps() external view returns (uint16);
```

Fees:

- Maker fee is charged from claim proceeds.
- Taker fee is charged on input amount.
- Max per-side fee is 1000 bps.
- Zero fees preserve old behavior.

## Maker ABI: asks

Sell `token0` across a range above current price.

```solidity
function deposit(int24 lower, int24 upper, uint128 liquidity) external returns (uint256 positionId);

function claim(uint256 positionId) external returns (uint256 proceeds1);
function claimTo(uint256 positionId, int24 target) external returns (uint256 proceeds1);
function cancel(uint256 positionId) external returns (uint256 proceeds1, uint256 principal0);
function cancelWithWitness(uint256 positionId, int24 frontier)
    external
    returns (uint256 proceeds1, uint256 principal0);
function claimable(uint256 positionId) external view returns (uint256);
function unfilledPrincipal(uint256 positionId) external view returns (uint256);
```

`claimable(...)`, `claim(...)`, `claimTo(...)`, and ask cancel proceeds are net of maker fee when maker fees are enabled.

Note: the deployed `GeometricFrontierBook` is **uniform-only** — ask ladders rest the same `liquidity` at every level. The shaped-ladder surface (`depositShaped`/`requoteShaped`, per-level `slope`) has been removed entirely; it lives only on the `archive/rolling-frontier-book` branch (no selector, no slope arithmetic, no `_positionSlope`/`frontierSlope` storage on the active book). Approximate a sloped profile with a few uniform `deposit` ladders. The `frontierSlope(int24)` getter and the `slope` field of `positions(...)` no longer exist on the ABI.

Note: `claimInternal`, `recycleBidIntoAsk`, `recycleAskIntoBid`, and `withdrawInternal` were removed to stay under the EIP-170 24576-byte limit.

## Maker ABI: bids

Buy `token0` with `token1` across a range below or at current price.

```solidity
function depositBid(int24 lower, int24 upper, uint128 liquidity) external returns (uint256 positionId);

function claimBid(uint256 positionId) external returns (uint256 proceeds0);
function claimBidTo(uint256 positionId, int24 target) external returns (uint256 proceeds0);
function cancelBid(uint256 positionId) external returns (uint256 proceeds0, uint256 refund1);
function cancelBidWithWitness(uint256 positionId, int24 frontier)
    external
    returns (uint256 proceeds0, uint256 refund1);
function bidClaimable(uint256 positionId) external view returns (uint256);
function bidRefundable(uint256 positionId) external view returns (uint256);
function bidLiquidity(int24 lowerTick) external view returns (uint128);
```

`bidClaimable(...)`, bid claim functions, and bid cancel proceeds are net of maker fee when maker fees are enabled.

Note: `claimBidInternal` was removed; use `claimBid` to receive proceeds directly.

## Position management ABI

```solidity
function positions(uint256 positionId) external view returns (
    address owner,
    int24 lower,
    int24 upper,
    uint128 liquidity,
    uint64 depositClock,
    int24 claimedUpper,
    bool live,
    bool isBid
);

function transferPosition(uint256 positionId, address to) external;
function requote(uint256 positionId, int24 newLower, int24 newUpper, uint128 newLiquidity) external;
function requoteBid(uint256 positionId, int24 newLower, int24 newUpper, uint128 newLiquidity) external;
```

The uniform-only `GeometricFrontierBook` has no shaped re-price entrypoint (`requoteShaped` lives only on the `archive/rolling-frontier-book` branch).

Requotes and transfers require the owner or an authorized delegate.

## Taker ABI: direct book

```solidity
function sweepWithLimits(
    int24 target,
    uint256 maxFills,
    uint256 maxPay,
    uint256 minOut,
    uint256 deadline
) external returns (int24 reached, uint256 paid, uint256 received);
```

Direction:

- `target > currentTick`: buy `token0` from asks, pay `token1`.
- `target < currentTick`: sell `token0` into bids, pay `token0`, receive `token1`.

`paid` includes taker fee when fees are enabled.

Production taker agents should set all of `maxFills`, `maxPay`, `minOut`, and `deadline`.

## Taker ABI: router

```solidity
function buyExactIn(address book, uint256 amount1In, uint256 minOut0, address to, uint256 deadline)
    external
    returns (uint256 paid1, uint256 received0);

function sellExactIn(address book, uint256 amount0In, uint256 minOut1, address to, uint256 deadline)
    external
    returns (uint256 paid0, uint256 received1);

function swapExactTokensForTokens(
    uint256 amountIn,
    uint256 amountOutMin,
    address[] calldata path,
    address to,
    uint256 deadline
) external returns (uint256[] memory amounts);

function getAmountsOut(uint256 amountIn, address[] calldata path) external view returns (uint256[] memory amounts);
```

For router calls, approve the input token to the router. The router handles book approval and refunds unspent input.

## Lens ABI

```solidity
function summary(FrontierBookBase book, int24 scanWindow) external view returns (BookSummary memory);
function depth(FrontierBookBase book, int24 fromTick, int24 toTick, uint256 maxLevels)
    external
    view
    returns (Level[] memory);
function quoteBuy(FrontierBookBase book, uint256 amount1In)
    external
    view
    returns (uint256 amount0Out, uint256 amount1Spent, int24 endTick);
function quoteSell(FrontierBookBase book, uint256 amount0In, uint256 maxRuns)
    external
    view
    returns (uint256 amount1Out, uint256 amount0Spent, int24 endTick);
function curveOf(FrontierBookBase book) external view returns (Curve memory);
```

Agent rule: quote first, apply slippage, then submit through router or direct book.

## Permission registry ABI

```solidity
function grant(address operator, address target, bytes4 selector) external;
function grantWithExpiry(address operator, address target, bytes4 selector, uint48 expiry) external;
function revoke(address operator, address target, bytes4 selector) external;
function grantFull(address operator, address target) external;
function grantFullWithExpiry(address operator, address target, uint48 expiry) external;
function revokeAll(address operator, address target) external;
function grantSelectorBundle(address operator, address target, bytes4[] calldata selectors, uint48 expiry) external;
function isAuthorizedCall(address user, address operator, address target, bytes4 selector)
    external
    view
    returns (bool);
function permissionExpiry(address user, address operator, address target, bytes4 selector) external view returns (uint48);
function permissionNonce(address user) external view returns (uint256);
```

Prefer selector-scoped and expiring grants. Use full-target grants only for trusted automation.

## Deploy-day checklist

Before broadcast:

- `cd prototype && forge build`
- `cd prototype && forge test`
- Dry-run `DeployFrontier.s.sol` with target RPC and real env vars.
- Confirm token order, spacing, start tick, fee recipient, maker fee, and taker fee.

After broadcast:

- Save deployment JSON.
- Verify contracts on explorer if supported.
- Confirm `currentTick`, `tickSpacing`, fee config, and token addresses.
- Place one tiny ask and one tiny bid.
- Quote buy/sell through lens.
- Execute one tiny router buy or sell.
- Claim or cancel the test position.
- Confirm fee recipient balance increases if fees are nonzero.

## Known limits for agents

These are constraints, not blockers for the standalone deploy:

- Multiple books can exist for the same token pair; use explicit book addresses.
- Lens depth is bounded by scan window and max levels.
- Large taker strategies should use bounded direct sweeps or repeated router calls.
- Hooks, singleton credits, referrers, and maker rebates are separate future features.
- Use normal ERC20s for deploy day. Avoid rebasing, fee-on-transfer, callback-heavy, or broken-return tokens.
