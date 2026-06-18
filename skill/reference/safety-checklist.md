# Safety checklist

## Before any write

- [ ] Using the **explicit** `book` address (not `defaultBook` under ambiguity).
- [ ] Ticks aligned to `tickSpacing`; correct side (asks above, bids at/below).
- [ ] Right token approved to the right spender (book for deposits; router for
      taker input), amount covers principal **and** taker fee where relevant.
- [ ] Deadline set; direct sweeps bound by `maxFills`, `maxPay`, `minOut`.
- [ ] Quote is fresh (re-quoted near execution) with sane slippage.
- [ ] Dry-run / simulate first (the MCP server simulates before broadcast).

## Before creating a market

- [ ] `token0 != token1`; both real, non-zero ERC20s; ordering intended.
- [ ] `tickSpacing > 0`; `startTick % tickSpacing == 0`.
- [ ] `makerFeeBps <= 1000`, `takerFeeBps <= 1000`.
- [ ] `feeRecipient != 0` if either fee is non-zero.
- [ ] Decided: router-only taker flow vs direct book flow for agents.

## Post-deploy smoke test (before announcing a market)

- [ ] Deployment JSON has `book`, `factory`, `router`, `lens`, `registry`,
      `feeRecipient`, `makerFeeBps`, `takerFeeBps`
      (validate against [`../../docs/deployment-schema.json`](../../docs/deployment-schema.json)).
- [ ] `book.currentTick()` == configured start tick.
- [ ] `book.tickSpacing()` == configured spacing.
- [ ] Place one tiny **ask** above current tick.
- [ ] Place one tiny **bid** at/below current tick.
- [ ] Quote a buy and a sell through `FrontierLens`.
- [ ] Execute one tiny router buy or sell with slippage + deadline.
- [ ] Claim or cancel the test position.
- [ ] If fees are non-zero, confirm the fee recipient balance increased.
- [ ] Save all addresses and the smoke-test tx hashes.

## Operational hygiene for bots

- [ ] Persist `{ positionId, owner, book, side, lower, upper, liquidity, strategy }`
      after every deposit.
- [ ] Grants are selector-scoped and time-bound; revoke when done.
- [ ] Treat any configured private key as hot-wallet material.
- [ ] Only normal ERC20s — no rebasing / fee-on-transfer / callback tokens.
- [ ] Stay on the deploy-day path — no hooks, singleton credits, referrers, or
      rebates without separate review.
