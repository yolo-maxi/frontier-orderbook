# Frontier contract-interface reference

An OpenRPC-style reference for the deploy-day Frontier contracts: every read and
write method, the events they emit, the revert conditions, and copy-pasteable
examples. This is the machine-and-agent companion to the prose guides
([`../skill.md`](../skill.md)) and the compact ABI map
([`frontier-abi-interface.md`](./frontier-abi-interface.md)).

Source of truth: the generated ABIs at [`../abi/*.json`](../abi). The
[`@frontier/sdk`](../../sdk) ships these as typed `as const` objects and the
[`@frontier/mcp`](../../mcp) server exposes them as tools.

## Conventions

- `token0` = base asset (sold by asks, bought by bids).
- `token1` = quote asset (paid by ask takers, deposited by bid makers).
- A position covers a half-open range `[lower, upper)`; ticks are aligned to
  `tickSpacing`. Asks rest strictly above `currentTick`; bids rest at/below it.
- Prices follow the geometric curve `1.0001^tick`.
- Token amounts in JSON are decimal strings of the underlying `uint256`.
- `int24` ticks range `[-8388608, 8388607]`.
- The deployed `GeometricFrontierBook` is **uniform-only** — one liquidity size
  per level; the shaped-ladder surface is gone (archive branch only).
- Reverts are `require`-string reverts (listed per method), except
  `PermissionRegistry`, which uses custom errors.

## Contract index

| Contract | Role | ABI |
| --- | --- | --- |
| `FrontierGeoBookFactory` | Create/look up geometric books | [factory](../abi/FrontierGeoBookFactory.json) |
| `GeometricFrontierBook` | The market book (maker + taker) | [book](../abi/GeometricFrontierBook.json) |
| `FrontierRouter` | Exact-input taker periphery | [router](../abi/FrontierRouter.json) |
| `FrontierLens` | Read-only quote/depth | [lens](../abi/FrontierLens.json) |
| `PermissionRegistry` | Selector-scoped delegation | [registry](../abi/PermissionRegistry.json) |

---

## FrontierGeoBookFactory

### Writes

#### `createGeoBookWithFees(token0, token1, tickSpacing, startTick, feeRecipient, makerFeeBps, takerFeeBps) → address book`

Create a fee-enabled geometric book.

- `feeRecipient` must be non-zero if either fee is non-zero.
- Emits `BookCreated`.
- Reverts: `"bad tokens"` (token0 == token1 or zero), `"bad ticks"`
  (`tickSpacing <= 0` or `startTick % tickSpacing != 0`), `"fee too high"`
  (`> 1000` bps), `"fee recipient required"`, `"geo book deploy failed"`.

```solidity
address book = factory.createGeoBookWithFees(TOKEN0, TOKEN1, 60, 0, FEE_RECIPIENT, 0, 30);
```

#### `createGeoBook(token0, token1, tickSpacing, startTick) → address book`

Zero-fee shortcut. Same validation minus fees. Emits `BookCreated`.

#### `createGeoBookWithHooks(...)` / `createGeoBookWithHooksAndFees(...)`

Hook-enabled creation. **Not part of the deploy-day path** — use only after a
hook-specific audit.

### Reads

| Method | Returns | Notes |
| --- | --- | --- |
| `defaultBook(token0, token1)` | `address` | First-created book for a pair, or zero. Avoid when multiple books exist. |
| `getBook(token0, token1, tickSpacing)` | `address` | Book for a pair + spacing, or zero. |
| `books(uint256 index)` | `address` | Book by index. |
| `bookCount()` | `uint256` | Total books created. |
| `permissionRegistry()` | `address` | Registry wired into created books. |

### Events

```solidity
event BookCreated(
  address book, address token0, address token1,
  int24 tickSpacing, int24 startTick, address creator,
  address hooks, address feeRecipient, uint16 makerFeeBps, uint16 takerFeeBps
);
```

---

## GeometricFrontierBook

### Config reads

| Method | Returns |
| --- | --- |
| `token0()` / `token1()` | `address` |
| `tickSpacing()` | `int24` |
| `currentTick()` | `int24` |
| `feeRecipient()` | `address` |
| `makerFeeBps()` / `takerFeeBps()` | `uint16` |
| `hooks()` | `address` (zero on the deploy-day book) |
| `permissions()` | `address` (PermissionRegistry) |
| `MAX_FEE_BPS()` | `uint16` (1000) |
| `FEE_BPS_DENOMINATOR()` | `uint256` (10000) |
| `nextPositionId()` | `uint256` |
| `fillClock()` | `uint64` lifecycle clock |

### Ask maker

#### `deposit(int24 lower, int24 upper, uint128 liquidity) → uint256 positionId`

Place a resting ask: sell `token0` over `[lower, upper)` above current price.
Pulls `token0`; approve the book first. Emits `Deposit`.

- Reverts: `"unaligned"`, `"empty range"` (`lower >= upper`), `"zero liquidity"`,
  `"range not below price"` for the bid-only error path, `"pull failed"`.

```solidity
int24 lower = book.currentTick() + book.tickSpacing();
token0.approve(address(book), liquidity);
uint256 id = book.deposit(lower, lower + 10 * book.tickSpacing(), liquidity);
```

#### `claim(uint256 positionId) → uint256 proceeds1`

Settle filled proceeds (net of maker fee) in `token1`. Emits `Claim`, and
`MakerFee` when fees are on. Reverts: `"not live"`, `"nothing to claim"`.

#### `claimTo(uint256 positionId, int24 target) → uint256 proceeds1`

Claim only up to `target` tick. Useful to bound gas.

#### `claimAuto(uint256 positionId, uint256 minProceeds) → uint256 proceeds1`

Keeper-friendly claim: settles the ask to its current frontier and reverts
unless net proceeds reach `minProceeds`. Proceeds still go to the position
**owner** — operators manage, never receive — so a bot can batch claims and
fail cheaply when there's nothing material to harvest, removing the off-chain
"is this tx worth it?" race. The owner may call it directly; any other caller
needs a `claimTo` grant in the `PermissionRegistry` (the authorized selector
reached internally). Reverts: `"not live"`, `"use bid methods"`,
`"nothing to claim"`, `"below min proceeds"`.

```solidity
// harvest only if the position has earned at least 25 USDC, else revert cheap
uint256 proceeds1 = book.claimAuto(positionId, 25e6);
```

#### `frontierOf(uint256 positionId) → int24`

The position's current **ask frontier**: the highest boundary covered by any
up-sweep since deposit, clamped to the position's range. Exposes on-chain what
integrators previously reconstructed from a boundary witness off-chain; returns
`claimedUpper` for a fully-unfilled position. Reverts `"not a live ask"` for
dead or non-ask positions. Pair with `claimTo(positionId, frontierOf(...))` for
a fully on-chain witnessed claim.

#### `cancel(uint256 positionId) → (uint256 proceeds1, uint256 principal0)`

Return filled proceeds + unfilled `token0` principal and end eligibility.
Emits `Cancel`. Reverts: `"not live"`.

#### `cancelWithWitness(uint256 positionId, int24 frontier) → (uint256, uint256)`

Cancel using a caller-supplied frontier witness (gas optimization for deep books).

### Bid maker

Symmetric to asks but pays `token1` and receives `token0`.

| Method | Returns | Notes |
| --- | --- | --- |
| `depositBid(lower, upper, liquidity)` | `uint256 positionId` | Buy token0 at/below price; approve token1. Reverts `"range not below price"` if `upper > currentTick`. |
| `claimBid(positionId)` | `uint256 proceeds0` | Net token0 proceeds. |
| `claimBidTo(positionId, target)` | `uint256 proceeds0` | Bounded claim. |
| `claimBidAuto(positionId, minProceeds)` | `uint256 proceeds0` | Keeper-friendly mirror of `claimAuto`: settles the bid to its frontier, reverting `"nothing to claim"` / `"below min proceeds"`. Proceeds go to the owner. |
| `bidFrontierOf(positionId)` | `int24` | Current **bid frontier**: lowest boundary covered by any down-sweep since deposit, clamped to range. Reverts `"not a live bid"`. Mirror of `frontierOf`. |
| `cancelBid(positionId)` | `(proceeds0, refund1)` | Proceeds + token1 refund. |
| `cancelBidWithWitness(positionId, frontier)` | `(proceeds0, refund1)` | Witnessed cancel. |

### Position management

#### `positions(uint256 positionId) → (owner, lower, upper, liquidity, depositClock, claimedUpper, live, isBid)`

The full record. `depositClock` enforces epoch isolation (invariants I2/I8).

#### `requote(positionId, newLower, newUpper, newLiquidity)` / `requoteBid(...)`

Move/resize a live position. Owner or authorized delegate only.

#### `transferPosition(positionId, to)`

Transfer ownership (owner/delegate). Emits `PositionTransferred`.

### Position views

| Method | Returns | Notes |
| --- | --- | --- |
| `claimable(positionId)` | `uint256` | Net token1 claimable (ask). |
| `bidClaimable(positionId)` | `uint256` | Net token0 claimable (bid). |
| `unfilledPrincipal(positionId)` | `uint256` | Unfilled token0 (ask). |
| `bidRefundable(positionId)` | `uint256` | Refundable token1 (bid). |
| `isConsumedFor(positionId, lowerTick)` | `bool` | Whether a level is consumed. |
| `activeLiquidity(lowerTick)` | `uint128` | Aggregate ask liquidity at a level. |
| `bidLiquidity(lowerTick)` | `uint128` | Aggregate bid liquidity at a level. |
| `frontierOf(positionId)` | `int24` | Ask fill frontier on-chain (see [Ask maker](#ask-maker)). |
| `bidFrontierOf(positionId)` | `int24` | Bid fill frontier on-chain (see [Bid maker](#bid-maker)). |
| `rateAt(int24 t)` | `uint256` | Geometric rate at a tick. |

> For a single fully-resolved snapshot — owner, range, frontier, claimable, and
> unfilled principal in one struct — prefer `FrontierLens.positionView` /
> `positionViews` / `positionsOf` over composing these getters by hand.

### Taker (direct)

#### `sweepWithLimits(int24 target, uint256 maxFills, uint256 maxPay, uint256 minOut, uint256 deadline) → (int24 reached, uint256 paid, uint256 received)`

Protected direct sweep. `target > currentTick` buys token0 (pays token1);
`target < currentTick` sells token0 (pays token0, receives token1). `paid`
includes taker fee. Emits `RunFilled` / `IntervalFilled` per consumed run, plus
`TakerFee` when fees are on.

- Reverts: `"expired"` (deadline), `"unaligned target"`, `"bad target"`,
  `"below min proceeds"` / `"insufficient output"` (minOut), `"transfer out failed"`.
- **Always** set all four bounds. Prefer the router for normal swaps.

#### `sweep(int24 target, uint256 maxFills) → int24 reached`

Unprotected sweep (no pay/out/deadline bounds). Internal/advanced use only.

#### `moveTickTo(int24 newTick)`

Not a swap — lacks min-out/pay/deadline guards. Do not use as a trade path.

### Events

```solidity
event Deposit(uint256 positionId, address owner, int24 lower, int24 upper, uint128 liquidity);
event Claim(uint256 positionId, uint256 proceeds1);
event Cancel(uint256 positionId, uint256 proceeds1, uint256 principal0);
event Requote(uint256 positionId, int24 lower, int24 upper, uint128 liquidity);
event PositionTransferred(uint256 positionId, address from, address to);
event RunFilled(int24 fromLevel, int24 toBoundary, uint256 startSize, uint64 clock);
event IntervalFilled(int24 lowerTick, uint128 liquidity, uint256 proceeds1, uint64 clock);
event MakerFee(uint256 positionId, address token, uint256 grossProceeds, uint256 fee, uint256 netProceeds, address recipient);
event TakerFee(address payer, address token, uint256 grossInput, uint256 fee, uint256 totalPaid, address recipient);
```

> The book uses `require`-string reverts, not custom errors. Common strings:
> `"unaligned"`, `"empty range"`, `"zero liquidity"`, `"not live"`,
> `"nothing to claim"`, `"not filled"`, `"range not below price"`,
> `"not a bid"`, `"use bid methods"`, `"expired"`, `"bad target"`,
> `"unaligned target"`, `"below min proceeds"`, `"insufficient output"`,
> `"transfer out failed"`, `"fill payout failed"`, `"pull failed"`.

---

## FrontierRouter

The user-facing exact-input taker path. Approve the **input** token to the
router; it handles book approval and refunds unspent input.

### Writes

#### `buyExactIn(address book, uint256 amount1In, uint256 minOut0, address to, uint256 deadline) → (uint256 paid1, uint256 received0)`

Spend `token1` to buy `token0`. `paid1` includes the taker fee; unspent input is
refunded to the caller. Reverts: `"expired"`, `"insufficient output"`,
`"no book for pair"`, `"approve failed"`, `"refund failed"`, `"pull failed"`.

```solidity
(uint256 out,,) = lens.quoteBuy(book, amount1In);
uint256 minOut0 = out * 9950 / 10000;          // 0.5% slippage
token1.approve(address(router), amount1In);     // (+ fee if any)
(uint256 paid1, uint256 received0) = router.buyExactIn(book, amount1In, minOut0, msg.sender, block.timestamp + 300);
```

#### `sellExactIn(address book, uint256 amount0In, uint256 minOut1, address to, uint256 deadline) → (uint256 paid0, uint256 received1)`

Spend `token0` to receive `token1`. Symmetric to `buyExactIn`.

#### `swapExactTokensForTokens(amountIn, amountOutMin, address[] path, to, deadline) → uint256[] amounts`

Uniswap-style multi-hop. Reverts `"2-hop paths only"` for unsupported lengths.

### Reads

| Method | Returns |
| --- | --- |
| `getAmountsOut(amountIn, address[] path)` | `uint256[]` |
| `factory()` | `address` |
| `lens()` | `address` |
| `SWEEP_WINDOW()` | `int24` |

---

## FrontierLens

Read-only. **Quote first, apply slippage, then submit.**

| Method | Returns | Notes |
| --- | --- | --- |
| `quoteBuy(book, amount1In)` | `(amount0Out, amount1Spent, endTick)` | Buy token0 with token1. |
| `quoteSell(book, amount0In, maxRuns)` | `(amount1Out, amount0Spent, endTick)` | Sell token0; `maxRuns` bounds the scan. |
| `depth(book, fromTick, toTick, maxLevels)` | `Level[]` | `{ tick, askSize, bidSize }`. |
| `summary(book, scanWindow)` | `BookSummary` | `{ currentTick, tickSpacing, token0, token1, bestAsk, bestBid }`. |
| `bestPrices(book, scanWindow)` | `TopOfBook` | Inside market in one call (see below). |
| `positionView(book, positionId)` | `PositionView` | One fully-resolved position snapshot (see below). |
| `positionViews(book, positionIds[])` | `PositionView[]` | Batch snapshot for an explicit id set. |
| `positionsOf(book, owner, fromId, toId)` | `PositionView[]` | Every **live** position owned by `owner`, scanning ids in `[fromId, toId)` (`toId == 0` → `nextPositionId()`, `fromId == 0` → `1`). |
| `curveOf(book)` | `Curve` | `{ bool geo, uint256 d }`. |

Quotes are point-in-time; the book can move before execution. The
`positionsOf` scan is bounded by the caller's window so it stays an
`eth_call`-only convenience — page wide books, or use the indexer's
`/positions/{owner}` endpoint for unbounded history.

#### `bestPrices(book, scanWindow) → TopOfBook`

Top-of-book in a single read: best ask and bid, their resting sizes, X18 rates,
and the spread in ticks — everything a UI needs to render the inside market.
`scanWindow` bounds the search either side of `currentTick`.

```solidity
struct TopOfBook {
  int24 currentTick;
  int24 bestAsk;        // type(int24).max if no live ask in window
  uint128 bestAskSize;  // token0 resting at bestAsk
  uint256 bestAskRate;  // X18 token1/token0 at bestAsk (0 if none)
  int24 bestBid;        // type(int24).min if no live bid in window
  uint128 bestBidSize;  // token0-denominated size at bestBid
  uint256 bestBidRate;  // X18 at bestBid (0 if none)
  int24 spreadTicks;    // bestAsk - bestBid (type(int24).max if either side empty)
}
```

#### `positionView(book, positionId) → PositionView`

One fully-resolved position snapshot, routed through the book's own
frontier/claimable getters so the numbers match what a claim would actually
pay. Dead or zero ids return a zeroed view with `live == false`.

```solidity
struct PositionView {
  uint256 positionId;
  address owner;
  int24 lower;
  int24 upper;
  uint128 liquidity;
  int24 claimedUpper;
  bool live;
  bool isBid;
  int24 frontier;     // current fill frontier (ask: highest covered; bid: lowest)
  uint256 claimable;  // net token proceeds harvestable right now
  uint256 unfilled;   // principal still resting (token0 asks / token1 refundable bids)
}
```

`positionViews` returns the same struct for an explicit id list (one round
trip for a dashboard); `positionsOf` filters a contiguous id range to a single
owner's live positions.

---

## PermissionRegistry

Selector-scoped, optionally-expiring delegation. The **owner** signs grants; a
granted **operator** (bot) can then call the scoped selectors on the target book.

### Writes

| Method | Notes |
| --- | --- |
| `grant(operator, target, selector)` | Single selector, no expiry. |
| `grantWithExpiry(operator, target, selector, uint48 expiry)` | Single selector with expiry. |
| `grantSelectorBundle(operator, target, bytes4[] selectors, uint48 expiry)` | Several selectors at once (recommended). |
| `grantBatch(keys[])` / `grantBatchWithExpiry(entries[])` | Multiple (operator,target,selector) grants. |
| `grantFull(operator, target)` / `grantFullWithExpiry(...)` | Every selector on a target. Trusted automation only. |
| `revoke` / `revokeAll` / `revokeBatch` | Remove grants. |
| `permitPermission(permit, sig)` / `permitFullAuthorization(permit, sig)` | EIP-712 signed grants (gasless delegation). |

Emits `PermissionSet` (per-selector) and `AuthorizationSet` (bundle/full).

### Reads

| Method | Returns |
| --- | --- |
| `isAuthorizedCall(user, operator, target, selector)` | `bool` |
| `requireAuthorizedCall(user, operator, target, selector)` | reverts if not authorized |
| `permissionExpiry(user, operator, target, selector)` | `uint48` (0 = none) |
| `permissionNonce(user)` | `uint256` (EIP-712) |
| `domainSeparator()` | `bytes32` |
| `PERMISSION_PERMIT_TYPEHASH()` / `FULL_AUTHORIZATION_PERMIT_TYPEHASH()` | `bytes32` |
| `rawPermissionData(user, operator, target)` | `bytes` |

### Custom errors

`PermissionDenied`, `PermissionExpired`, `InvalidSelector`, `InvalidAddress`,
`InvalidExpiry`, `InvalidNonce`, `InvalidSignature`, `InvalidSignatureLength`,
`DeadlineExpired`.

### Common book selectors (for grants)

Verified against the bundled ABI by the SDK test suite.

| Function | Selector |
| --- | --- |
| `claim(uint256)` | `0x379607f5` |
| `claimTo(uint256,int24)` | `0xac3b68e3` |
| `claimAuto(uint256,uint256)` | `0x9dcda791` |
| `claimBidAuto(uint256,uint256)` | `0x74abbb9a` |
| `cancel(uint256)` | `0x40e58ee5` |
| `cancelWithWitness(uint256,int24)` | `0x260cfd8f` |
| `claimBid(uint256)` | `0x21113057` |
| `claimBidTo(uint256,int24)` | `0xabccb5ef` |
| `cancelBid(uint256)` | `0x9703ef35` |
| `cancelBidWithWitness(uint256,int24)` | `0x56e172a2` |
| `requote(uint256,int24,int24,uint128)` | `0xbcf82d31` |
| `requoteBid(uint256,int24,int24,uint128)` | `0x84616e58` |
| `transferPosition(uint256,address)` | `0x55bd513f` |

```solidity
bytes4[] memory sel = new bytes4[](3);
sel[0] = book.claim.selector;
sel[1] = book.cancel.selector;
sel[2] = book.requote.selector;
registry.grantSelectorBundle(agent, address(book), sel, uint48(block.timestamp + 1 days));
```

> Keeper note: `claimAuto` / `claimBidAuto` authorize the caller against the
> `claimTo` selector internally, so grant `claimTo(uint256,int24)` (`0xac3b68e3`)
> — not `claimAuto` — when delegating a harvest bot. Proceeds always pay the
> position owner regardless of who triggers the claim.

---

## See also

- [`agent-decision-tree.md`](./agent-decision-tree.md) — intent → contract path.
- [`frontier-abi-interface.md`](./frontier-abi-interface.md) — compact ABI map + deploy.
- [`deployment-schema.json`](./deployment-schema.json) / [`position-schema.json`](./position-schema.json) — JSON Schemas.
- [`../skill.md`](../skill.md) — full agent operating guide with examples.
- [`../../sdk`](../../sdk) — typed TypeScript SDK. [`../../mcp`](../../mcp) — MCP server.
