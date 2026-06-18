# Taker templates (swaps)

Takers move the frontier by consuming resting asks/bids. **Default to the router**
for normal exact-input swaps; use direct `sweepWithLimits` only when you run your
own quoting engine.

Golden rule: **quote → apply slippage → submit**, with a deadline.

## Buy token0 with token1 (router)

```solidity
(uint256 out0,,) = lens.quoteBuy(book, amount1In);
uint256 minOut0 = out0 * 9950 / 10000;        // 0.5% slippage

token1.approve(address(router), amount1In);    // + taker fee if any
(uint256 paid1, uint256 received0) =
    router.buyExactIn(book, amount1In, minOut0, recipient, block.timestamp + 300);
```

TypeScript (`TakerAgent` quotes, applies slippage, approves input + fee):

```ts
const taker = new TakerAgent(ROUTER, LENS, { publicClient, walletClient, account });
const tx = await taker.buy(book, {
  amountIn: 1000n * 10n ** 18n,
  minOut: 0n,        // 0 => auto-quote + slippageBps
  slippageBps: 50,
});
```

`paid1` includes the taker fee; the router refunds unspent input.

## Sell token0 for token1 (router)

```solidity
(uint256 out1,,) = lens.quoteSell(book, amount0In, maxRuns);
uint256 minOut1 = out1 * 9950 / 10000;

token0.approve(address(router), amount0In);
(uint256 paid0, uint256 received1) =
    router.sellExactIn(book, amount0In, minOut1, recipient, block.timestamp + 300);
```

```ts
const tx = await taker.sell(book, { amountIn: amount0In, minOut: 0n, slippageBps: 50 });
```

## Advanced: direct sweep with limits

Only when you control target tick and fill budget yourself:

```solidity
(int24 reached, uint256 paid, uint256 received) = book.sweepWithLimits(
    targetTick,
    64,                       // maxFills
    maxInputWithFee,          // maxPay
    minOutput,                // minOut
    block.timestamp + 300     // deadline
);
// target > currentTick → buy token0 ; target < currentTick → sell token0
```

`paid` includes the taker fee. **Always** set all four limits.

## Never do this

- `book.sweepWithLimits(target, type(uint256).max, type(uint256).max, 0, ...)` —
  unbounded fills/pay and zero min-out drains funds.
- `book.moveTickTo(target)` as a swap — no min-out/max-pay/deadline guards.
- Reusing a stale quote after several blocks — re-quote and keep slippage sane.
- Forgetting the taker fee when approving input — approve `amountIn + fee`.
