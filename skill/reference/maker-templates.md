# Maker templates (asks & bids)

Makers place resting liquidity. **Asks** sell `token0` above the current tick;
**bids** buy `token0` at/below it. Always persist the returned `positionId`.

## Ask: sell token0 above current price

```solidity
int24 spacing = book.tickSpacing();
int24 current = book.currentTick();
int24 lower = current + spacing;            // strictly above price
int24 upper = current + 10 * spacing;
uint128 liquidity = 1 ether;

token0.approve(address(book), liquidity);   // asks pay token0
uint256 positionId = book.deposit(lower, upper, liquidity);
```

TypeScript (`MakerAgent` handles approval + side/alignment validation):

```ts
const maker = new MakerAgent(book, { publicClient, walletClient, account });
const { lower, upper } = await maker.askRangeAbove(1, 10); // 1 spacing above, 10 wide
const tx = await maker.placeAsk(lower, upper, 1_000_000_000_000_000_000n);
```

## Bid: buy token0 below or at current price

```solidity
int24 spacing = book.tickSpacing();
int24 current = book.currentTick();
int24 upper = current;                       // at or below price
int24 lower = current - 10 * spacing;
uint128 liquidity = 1 ether;

token1.approve(address(book), requiredQuote); // bids pay token1
uint256 positionId = book.depositBid(lower, upper, liquidity);
```

```ts
const bid = await maker.bidRangeBelow(1, 10);
const tx = await maker.placeBid(bid.lower, bid.upper, 1_000_000_000_000_000_000n, quoteBudget);
```

Compute the token1 budget from a lens quote or your own engine; bids pay quote.

## Claim filled proceeds (keep resting)

```solidity
uint256 netToken1 = book.claim(positionId);     // ask, net of maker fee
uint256 netToken0 = book.claimBid(positionId);  // bid
```

`claimable(id)` / `bidClaimable(id)` preview the net amount. Use
`claimTo(id, target)` / `claimBidTo(id, target)` to bound gas on deep fills.

## Cancel (exit: proceeds + unfilled)

```solidity
(uint256 proceeds1, uint256 principal0) = book.cancel(positionId);     // ask
(uint256 proceeds0, uint256 refund1)   = book.cancelBid(positionId);   // bid
```

Cancel ends future eligibility. Check `unfilledPrincipal(id)` /
`bidRefundable(id)` first to decide claim vs cancel.

## Reprice / resize a live position

```solidity
book.requote(positionId, newLower, newUpper, newLiquidity);     // ask
book.requoteBid(positionId, newLower, newUpper, newLiquidity);  // bid
```

Owner or authorized delegate only. Re-check alignment and side for the new range.

## Sloped profiles

The book is uniform-only (one size per level). Approximate a slope by placing
several uniform `deposit` ladders at different ranges/sizes — there is no
`depositShaped`/`requoteShaped` on the deployed book.

## Common maker mistakes

- Placing an ask **below** current tick → use `depositBid`. (`"range not below price"`)
- Unaligned ticks → align to `tickSpacing`. (`"unaligned"`)
- `lower >= upper` → empty range. (`"empty range"`)
- Forgetting to approve the input token to the **book**. (`"pull failed"`)
- Losing the `positionId` → you can't claim/cancel/requote/transfer.
