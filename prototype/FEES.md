# Experimental Maker/Taker Fees

This branch implements a simple fee model on Frontier books:

- maker fee: charged when a maker claims filled proceeds;
- taker fee: charged on sweep input before maker output is paid;
- fee config: immutable per book, with `feeRecipient`, `makerFeeBps`, and `takerFeeBps`;
- caps: each fee is capped at `MAX_FEE_BPS` (`1_000`, or 10%);
- zero fees preserve the previous behavior.

## Implemented Model

Maker fees are paid from claim proceeds. Ask claims compute gross token1 proceeds, charge the maker fee in token1, and pay the maker the net. Bid claims compute gross token0 proceeds, charge the maker fee in token0, and pay the maker the net. `claimable` and `bidClaimable` return the net claimable amount.

Taker fees are paid in the taker's input token. Up-sweeps pay token1 input plus a token1 fee, then receive token0 output. Down-sweeps pay token0 input plus a token0 fee, then receive token1 output. Maker output is not reduced by the taker fee. `sweepWithLimits` returns `paid` as the total paid amount, including the taker fee, so exact-input routers can refund from the same value they already read.

The book emits:

- `MakerFee(positionId, token, grossProceeds, fee, netProceeds, recipient)`;
- `TakerFee(payer, token, grossInput, fee, totalPaid, recipient)`.

## Config And Deployment

The fee config is immutable on both the book and its matching maker-ops companion. This is required because cancels run through `delegatecall` and the companion reads its own immutables.

Deploy-day geometric markets use `FrontierGeoBookFactory.createGeoBookWithFees(...)` or `createGeoBook(...)`. The broader `FrontierBookFactory` still supports linear/geometric and hook-aware variants for tests and experiments. Both factories memoize maker-ops companions by immutable config so companion immutables match the book.

## Referrer Codes

A later referrer design can extend taker fees without changing maker accounting:

- add a taker entrypoint that accepts a referral code or referrer address;
- split the taker fee between `feeRecipient` and the referrer;
- emit the code/referrer in the taker fee event;
- keep the no-referrer path as the current default.

The current implementation keeps all taker-fee routing in one payment helper, so the split can be localized there.

## Maker Rebates

Maker rebates can be layered onto claim settlement:

- record enough placement metadata for eligibility, such as deposit clock or block;
- compute a rebate from claimed gross proceeds based on age, volume, or policy tiers;
- pay the maker `gross - fee + rebate` if funded, or reduce the charged fee by the rebate amount;
- prefer older orders over same-block orders to avoid rewarding just-in-time liquidity.

The current fee events expose gross proceeds, fee, and net proceeds, which gives off-chain accounting a clean starting point for rebate simulations.

## Risks And Tradeoffs

- Fee-inclusive `maxPay` may leave small unused budget because the book computes a conservative gross input budget before applying the fee.
- Maker claim rounding follows the same basis-point floor rule as taker fees; tiny claims can pay zero fee.
- Immutable config is simple and reviewable for the experiment, but production governance may need controlled updates or per-market schedules.
- Referrer and rebate funding are not implemented in this branch.
