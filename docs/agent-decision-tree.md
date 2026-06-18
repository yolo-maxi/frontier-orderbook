# Frontier agent decision tree

Map an **intent** to the right **contract path**. Use this to route a request to
the correct call, with the guardrails an agent must apply. Pairs with
[`contract-interface-reference.md`](./contract-interface-reference.md) (exact
signatures) and [`../skill.md`](../skill.md) (worked examples).

Everything here is the deploy-day path: `GeometricFrontierBook` created through
`FrontierGeoBookFactory`, quoted via `FrontierLens`, taken via `FrontierRouter`,
delegated via `PermissionRegistry`.

## Top-level routing

```
What does the user/agent want to do?
├─ Deploy a venue ............................ DeployFrontier.s.sol (off-chain script)
├─ Create / find a market ................... FrontierGeoBookFactory
├─ Provide liquidity (make markets) ......... GeometricFrontierBook deposit/depositBid
├─ Trade (take liquidity) ................... FrontierRouter (default) | book.sweepWithLimits (advanced)
├─ Manage an existing position .............. GeometricFrontierBook claim/cancel/requote/transfer
├─ Read prices / depth / state ............. FrontierLens (+ book views)
└─ Let a bot act for an owner .............. PermissionRegistry
```

## 1. Create or find a market

```
Need a market for (token0, token1)?
├─ A book may already exist
│   ├─ exactly one expected → factory.defaultBook(token0, token1)
│   └─ specific spacing      → factory.getBook(token0, token1, tickSpacing)
│       └─ returns non-zero? → use it; persist the address
└─ Create a new one
    ├─ validate first (SDK MarketCreator.validate / contract reverts):
    │     token0 != token1, both non-zero, tickSpacing > 0,
    │     startTick % tickSpacing == 0, fee bps <= 1000,
    │     feeRecipient != 0 if any fee > 0
    ├─ zero fees → factory.createGeoBook(token0, token1, tickSpacing, startTick)
    └─ fees      → factory.createGeoBookWithFees(..., feeRecipient, makerFeeBps, takerFeeBps)
    → read `book` from the BookCreated event and PERSIST it
```

Never trust `defaultBook` when multiple books may exist for a pair — always
persist and reuse the explicit `book` address.

## 2. Make markets (provide liquidity)

```
Which way do you want to be filled?
├─ Sell token0 as price rises → ASK
│   ├─ choose [lower, upper) with lower >= currentTick, aligned to tickSpacing
│   ├─ approve token0 to the book (>= liquidity used)
│   ├─ book.deposit(lower, upper, liquidity) → positionId
│   └─ PERSIST { positionId, owner, book, side:"ask", lower, upper, liquidity, strategy }
└─ Buy token0 as price falls → BID
    ├─ choose [lower, upper) with upper <= currentTick, aligned
    ├─ approve token1 to the book (>= quote needed; compute via lens/own engine)
    ├─ book.depositBid(lower, upper, liquidity) → positionId
    └─ PERSIST the same metadata with side:"bid"
```

Want a sloped profile? The book is uniform-only — place a few uniform `deposit`
ladders to approximate a slope.

## 3. Trade (take liquidity)

```
Normal exact-input swap?
├─ YES → FrontierRouter
│   ├─ quote: lens.quoteBuy(book, amountIn) | lens.quoteSell(book, amountIn, maxRuns)
│   ├─ minOut = quote.amountOut * (1 - slippage)
│   ├─ approve INPUT token to the router (amountIn + taker fee)
│   ├─ buy:  router.buyExactIn(book, amount1In, minOut0, to, deadline)
│   └─ sell: router.sellExactIn(book, amount0In, minOut1, to, deadline)
│       (router refunds unspent input)
└─ NO — you run your own quoting engine / want target-tick control
    └─ book.sweepWithLimits(target, maxFills, maxPay, minOut, deadline)
        target > currentTick → buy token0 ; target < currentTick → sell token0
        ALWAYS set maxFills, maxPay, minOut, deadline
```

Never call `book.moveTickTo` or `book.sweep` as a user swap — they lack
min-out / max-pay / deadline guards.

## 4. Manage a position

```
Have a positionId. What now?
├─ Collect filled proceeds, keep resting
│   ├─ ask → book.claim(id)      (or claimTo(id, target) to bound gas)
│   └─ bid → book.claimBid(id)   (or claimBidTo(id, target))
├─ Exit entirely (proceeds + unfilled principal/refund)
│   ├─ ask → book.cancel(id)        → (proceeds1, principal0)
│   └─ bid → book.cancelBid(id)     → (proceeds0, refund1)
├─ Reprice / resize a live position
│   ├─ ask → book.requote(id, newLower, newUpper, newLiquidity)
│   └─ bid → book.requoteBid(...)
└─ Hand ownership to another address
    └─ book.transferPosition(id, to)
```

Decide claim vs cancel by reading first:
`claimable`/`bidClaimable` (proceeds) and `unfilledPrincipal`/`bidRefundable`
(still-resting inventory). Cancel ends future eligibility; claim does not.

## 5. Read state

```
What do you need to read?
├─ Best ask/bid, current tick, tokens → lens.summary(book, scanWindow)
├─ Aggregated depth across a range    → lens.depth(book, fromTick, toTick, maxLevels)
├─ Price of an exact-input swap       → lens.quoteBuy / lens.quoteSell
├─ One position's full state          → book.positions(id) + claimable/unfilled views
├─ Book config / fees                 → book.token0/token1/tickSpacing/currentTick/feeBps
└─ Historical fills / account rollups → indexer REST API (see indexer/openapi.yaml)
```

## 6. Delegate to a bot

```
Should a bot manage positions owned by someone else?
├─ NO  → the owner calls the book directly
└─ YES → PermissionRegistry, scoped as tightly as possible
    ├─ best: grantSelectorBundle(agent, book, [claim, cancel, requote], expiry)
    ├─ single action: grant / grantWithExpiry(agent, book, selector[, expiry])
    ├─ gasless: permitPermission / permitFullAuthorization (EIP-712 signed)
    ├─ avoid: grantFull(agent, book) unless the bot is fully trusted
    └─ verify: isAuthorizedCall(owner, agent, book, selector) before relying on it
    Funds still settle to the OWNER; the agent only triggers actions.
```

## Cross-cutting guardrails

Apply on every write, regardless of branch:

1. **Quote → slippage → submit** for takes. Re-quote near execution.
2. **Align ticks** to `tickSpacing`; respect side (asks above, bids at/below).
3. **Set deadlines** and bound any direct sweep (`maxFills`, `maxPay`, `minOut`).
4. **Approve the right token**: token0 for asks/sells, token1 for bids/buys;
   add the taker fee on top for taker input.
5. **Persist `positionId`** plus owner/book/side/range/strategy after deposits.
6. **Use explicit `book` addresses** — never `defaultBook` under ambiguity.
7. **Use normal ERC20s.** Avoid rebasing / fee-on-transfer / callback tokens.
8. **Dry-run first** where possible (the MCP server simulates before broadcast).

## Intent → call quick reference

| Intent | Call |
| --- | --- |
| Create fee market | `factory.createGeoBookWithFees(...)` |
| Create zero-fee market | `factory.createGeoBook(...)` |
| Find existing market | `factory.defaultBook` / `factory.getBook` |
| Sell token0 above price | `book.deposit(lower, upper, liquidity)` |
| Buy token0 below price | `book.depositBid(lower, upper, liquidity)` |
| Buy token0 now | `router.buyExactIn(book, amount1In, minOut0, to, deadline)` |
| Sell token0 now | `router.sellExactIn(book, amount0In, minOut1, to, deadline)` |
| Advanced take | `book.sweepWithLimits(target, maxFills, maxPay, minOut, deadline)` |
| Collect proceeds | `book.claim(id)` / `book.claimBid(id)` |
| Exit position | `book.cancel(id)` / `book.cancelBid(id)` |
| Reprice | `book.requote(...)` / `book.requoteBid(...)` |
| Transfer position | `book.transferPosition(id, to)` |
| Quote | `lens.quoteBuy` / `lens.quoteSell` |
| Depth / summary | `lens.depth` / `lens.summary` |
| Delegate to bot | `registry.grantSelectorBundle(agent, book, selectors, expiry)` |
| Check delegation | `registry.isAuthorizedCall(owner, agent, book, selector)` |
