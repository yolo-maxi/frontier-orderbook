# Frontier Contract Skill

Use this skill when an agent needs to create a Frontier market, make markets, take liquidity, manage positions, or delegate position management.

This file is the canonical agent-facing operating guide for the deploy-ready Frontier contracts.

## Current deploy stance

Frontier is deploy-ready as a standalone onchain order-book venue when deployed through the real-token script and the smoke-test checklist below.

Canonical deploy path:

- Deploy `PermissionRegistry`, `FrontierGeoBookFactory`, `FrontierLens`, and `FrontierRouter` through `prototype/script/DeployFrontier.s.sol` with `FOUNDRY_PROFILE=deploy`.
- Create real markets as `GeometricFrontierBook` instances through `FrontierGeoBookFactory.createGeoBookWithFees(...)`.
- Use explicit deployed `book`, `router`, `lens`, `factory`, and `registry` addresses in agents.
- Use immutable per-book maker/taker fees. Zero fees are supported; nonzero fees require a fee recipient.

Create all geometric markets — production and tests alike — through `FrontierGeoBookFactory`.

Do not use these for production market creation unless you are deliberately testing:

- Mock-token demo deployment scripts.
- Hook-enabled books without a dedicated audit.
- Singleton/global-credit prototype branches.

## Mental model

Frontier is a range-order book.

- `token0` is the base asset.
- `token1` is the quote asset.
- Asks sell `token0` for `token1` above the current tick.
- Bids buy `token0` with `token1` below or at the current tick.
- A position covers a half-open tick range: `[lower, upper)`.
- Ticks must be aligned to `tickSpacing`.
- The geometric book prices levels using the `1.0001^tick` curve.
- Claims settle filled proceeds; cancels settle filled proceeds plus unfilled inventory/refunds.

## Contract roles

### `FrontierGeoBookFactory`

Deploy-day factory for geometric books. It creates books and tracks the default book for a token pair.

Use explicit book addresses after creation. Do not rely on `defaultBook` if multiple books exist for the same pair.

Important functions:

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
```

Zero-fee equivalent:

```solidity
function createGeoBook(address token0, address token1, int24 tickSpacing, int24 startTick)
    external
    returns (address book);
```

### `GeometricFrontierBook`

The production-candidate market book.

Use it for real markets unless you have a specific reason not to.

### `FrontierRouter`

Exact-input taker periphery.

Best default for user-facing swaps because it handles book approvals and refunds unspent input.

### `FrontierLens`

Read-only quote/depth helper.

Agents should quote through the lens before taker transactions.

### `PermissionRegistry`

Selector-scoped delegation for maker agents.

Use it when a bot manages positions owned by a human or another account.

## Market creator guide

### Positive example: create a real fee-enabled geometric market

Use this when deploying a market for a project.

```solidity
address book = factory.createGeoBookWithFees({
    token0: TOKEN0,
    token1: TOKEN1,
    tickSpacing: 60,
    startTick: 0,
    feeRecipient: FEE_RECIPIENT,
    makerFeeBps: 0,
    takerFeeBps: 30
});
```

Why this is good:

- Uses the geometric curve.
- Uses explicit token ordering.
- Uses immutable fee config.
- Keeps maker fee at zero and charges a simple taker fee, which is easiest for makers to reason about.

### Positive example: create a zero-fee geometric market

```solidity
address book = factory.createGeoBook(TOKEN0, TOKEN1, 60, 0);
```

Why this is good:

- Preserves zero-fee behavior.
- Useful for early liquidity bootstrapping or internal testing.

### Negative example: relying on default book lookup when multiple books may exist

```solidity
address book = factory.defaultBook(token0, token1);
router.buyExactIn(book, amountIn, minOut, to, deadline);
```

Why this can be bad:

- `defaultBook` is first-created for a pair.
- A token pair can have multiple books with different spacing, start ticks, hooks, or fees.
- Agents should persist and use the exact book address created for the market.

### Required market-creation checks

Before creating a book:

- Confirm `token0 != token1`.
- Confirm both tokens are real ERC20 contracts.
- Confirm token ordering is intended and documented.
- Confirm `tickSpacing > 0`.
- Confirm `startTick % tickSpacing == 0`.
- Confirm `makerFeeBps <= 1000` and `takerFeeBps <= 1000`.
- Confirm `feeRecipient != address(0)` when either fee is nonzero.
- Decide whether agents should use router-only taker flow or direct book flow.

## Maker guide

Makers place resting liquidity ranges.

### Ask maker flow: sell token0 above current price

Use asks when the maker wants to sell `token0` as price moves up.

```solidity
int24 current = book.currentTick();
int24 lower = current + tickSpacing;
int24 upper = current + 10 * tickSpacing;
uint128 liquidity = 1 ether;

token0.approve(address(book), liquidity * 10);
uint256 positionId = book.deposit(lower, upper, liquidity);
```

Why this is good:

- Range is above current tick.
- Ticks are spacing-aligned.
- Approval is for the input asset: `token0`.
- The agent stores `positionId` for future claim/cancel/requote.

### Bid maker flow: buy token0 below or at current price

Use bids when the maker wants to buy `token0` as price moves down.

```solidity
int24 current = book.currentTick();
int24 upper = current;
int24 lower = current - 10 * tickSpacing;
uint128 liquidity = 1 ether;

uint256 requiredQuote = lensOrAgentComputedQuoteAmount;
token1.approve(address(book), requiredQuote);
uint256 positionId = book.depositBid(lower, upper, liquidity);
```

Why this is good:

- Bid range is at or below current tick.
- Approval is for `token1`, because bids pay quote asset.
- The agent stores the returned `positionId`.

### Maker claim flow

Ask claim:

```solidity
uint256 netToken1 = book.claim(positionId);
```

Bid claim:

```solidity
uint256 netToken0 = book.claimBid(positionId);
```

With maker fees, claim functions return net proceeds after maker fee. `claimable(...)` and `bidClaimable(...)` also return net amounts.

### Maker cancel flow

Ask cancel:

```solidity
(uint256 proceeds1, uint256 principal0) = book.cancel(positionId);
```

Bid cancel:

```solidity
(uint256 proceeds0, uint256 refund1) = book.cancelBid(positionId);
```

Cancel returns filled proceeds plus unfilled inventory/refund. Filled proceeds are net of maker fee when fees are enabled.

### Negative maker example: ask below current tick

```solidity
book.deposit(currentTick - 60, currentTick, liquidity);
```

Why this is bad:

- Asks must be above the current price.
- Use `depositBid(...)` for below-price liquidity.

### Negative maker example: forgetting position IDs

```solidity
book.deposit(lower, upper, liquidity);
```

Why this is bad:

- The returned `positionId` is required for claim, cancel, transfer, and requote.
- Agents must persist it together with owner, book, side, range, and strategy metadata.

## Taker guide

Takers move the frontier by consuming resting asks or bids.

Prefer `FrontierRouter` for normal exact-input swaps.

### Buy token0 with token1

```solidity
(uint256 amount0Out, uint256 amount1Spent, int24 endTick) = lens.quoteBuy(book, amount1In);
uint256 minOut0 = amount0Out * 9950 / 10000; // example 50 bps slippage

token1.approve(address(router), amount1In);
(uint256 paid1, uint256 received0) = router.buyExactIn(book, amount1In, minOut0, recipient, deadline);
```

Why this is good:

- Quotes before trading.
- Applies slippage via `minOut0`.
- Uses deadline.
- Router refunds unspent exact input.
- With taker fees, `paid1` includes the taker fee.

### Sell token0 for token1

```solidity
(uint256 amount1Out, uint256 amount0Spent, int24 endTick) = lens.quoteSell(book, amount0In, maxRuns);
uint256 minOut1 = amount1Out * 9950 / 10000;

token0.approve(address(router), amount0In);
(uint256 paid0, uint256 received1) = router.sellExactIn(book, amount0In, minOut1, recipient, deadline);
```

Why this is good:

- Uses lens quote.
- Bounds slippage.
- Bounds quote scan via `maxRuns`.
- Uses router exact-input flow.

### Advanced direct taker flow

Only use direct book sweeps when the agent deliberately controls target tick and fill budget.

```solidity
(int24 reached, uint256 paid, uint256 received) = book.sweepWithLimits({
    target: targetTick,
    maxFills: 64,
    maxPay: maxInputWithFee,
    minOut: minOutput,
    deadline: block.timestamp + 5 minutes
});
```

Why this can be good:

- Gives advanced agents control over target tick and maximum filled levels.
- Useful for arbitrage and market-making bots that maintain their own quoting engine.

### Negative taker example: no quote, no slippage

```solidity
book.sweepWithLimits(target, type(uint256).max, type(uint256).max, 0, block.timestamp + 1 hours);
```

Why this is bad:

- Unbounded fill count.
- Unbounded payment.
- Accepts any output.
- Dangerous for user funds.

### Negative taker example: using `moveTickTo` as a swap

```solidity
book.moveTickTo(target);
```

Why this is bad:

- It is not the user-facing protected swap path.
- It lacks the same explicit `maxPay`, `minOut`, and `deadline` controls.
- Use router or `sweepWithLimits(...)`.

### Negative taker example: assuming quotes are valid forever

```solidity
(uint256 out,,) = lens.quoteBuy(book, amountIn);
// wait several blocks
router.buyExactIn(book, amountIn, out, recipient, deadline);
```

Why this is bad:

- The book can move between quote and execution.
- Use fresh quotes and reasonable slippage.

## Fee behavior

Fee config is immutable per book.

- `makerFeeBps`: charged from maker claim proceeds.
- `takerFeeBps`: charged on taker input.
- `feeRecipient`: receives both maker and taker fees.
- Max fee: 1000 bps per side.
- Zero fees preserve old behavior.

Maker fee examples:

- Ask claim produces gross token1 proceeds.
- Book transfers maker fee in token1 to `feeRecipient`.
- Maker receives net token1.

Taker fee examples:

- Buy token0 with token1: taker pays gross token1 input plus token1 fee.
- Sell token0 for token1: taker pays gross token0 input plus token0 fee.
- Maker output is not reduced by taker fee.

Negative fee example:

```solidity
factory.createGeoBookWithFees(token0, token1, 60, 0, address(0), 100, 30);
```

Why this is bad:

- Nonzero fees require a nonzero recipient.

## Delegation guide

Use `PermissionRegistry` when an agent manages positions for a maker.

### Positive example: selector-scoped delegation

```solidity
registry.grant(agent, address(book), book.claim.selector);
registry.grant(agent, address(book), book.cancel.selector);
registry.grant(agent, address(book), book.requote.selector);
```

Why this is good:

- Grants only the actions the agent needs.
- Keeps other position functions unauthorized.
- Can be revoked selector by selector.

### Positive example: expiring bundle

```solidity
bytes4[] memory selectors = new bytes4[](3);
selectors[0] = book.claim.selector;
selectors[1] = book.cancel.selector;
selectors[2] = book.requote.selector;
registry.grantSelectorBundle(agent, address(book), selectors, uint48(block.timestamp + 1 days));
```

Why this is good:

- Limits duration.
- Limits selectors.
- Suitable for temporary automation.

### Negative example: full delegation by default

```solidity
registry.grantFull(agent, address(book));
```

Why this can be bad:

- Grants every book selector for that target.
- Use only for highly trusted automation.

## Smoke-test checklist after deploy

Run this before telling agents or users the market is live:

- Confirm deployment JSON has `book`, `factory`, `router`, `lens`, `registry`, `feeRecipient`, `makerFeeBps`, and `takerFeeBps`.
- Confirm `book.currentTick()` equals the configured start tick.
- Confirm `book.tickSpacing()` equals the configured spacing.
- Place one tiny ask above current tick.
- Place one tiny bid below or at current tick.
- Quote buy and sell through `FrontierLens`.
- Execute one tiny router buy or sell with slippage and deadline.
- Claim or cancel the test position.
- Confirm fee recipient balance increases if fees are nonzero.
- Save addresses and smoke-test transaction hashes.

## Confidence and limits

High confidence:

- Geometric book creation through factory.
- Maker ask/bid placement, claim, and cancel paths.
- Router exact-input buy/sell with lens quotes.
- Zero-fee behavior.
- Simple immutable maker/taker fee behavior after the fee-fuzz branch.
- Permission registry selector-scoped delegation.

Medium confidence:

- Large automated taker strategies using direct `sweepWithLimits(...)`; safe when agents bound `maxFills`, `maxPay`, `minOut`, and deadlines.
- Multi-book routing; agents should address explicit books and avoid default-book ambiguity.
- Non-standard ERC20s; use normal ERC20s for deploy day.

Do not treat as deploy-ready without separate review:

- Hook-enabled books.
- Singleton/global credit architecture.
- Referrer-code fee splitting.
- Maker rebates/emissions.
- Exotic ERC20s with rebases, transfer fees, callbacks, or broken return values.
