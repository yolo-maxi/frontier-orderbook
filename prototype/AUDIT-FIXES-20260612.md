# Frontier Audit Fix Notes - 2026-06-12

## Fixed

- Exact-transfer ERC20 accounting: inbound book, router, NFT, maker-kit, take-profit, and hook pool payments now require pre/post balance deltas to match the nominal amount.
- Geometric tick-domain DoS: geometric ask ranges, bid ranges, sweep targets, and initial ticks are bounded to `GeoTickMath.MAX_TICK`.
- Bid `isConsumedFor` side confusion: bid positions now use low-water history.
- LP vault geometric bid budgeting: `RangeLP`, `YieldRangeLP`, `FrontierPositionNFT`, and `FrontierMakerKit` use the book's exact `quoteBidPrincipal` helper.
- Permission selector expiry: selector-scoped permissions store per-selector expiries; refreshing one selector no longer extends siblings.
- Internal claims and transfers: unwithdrawn internal credit already claimed from a position moves with `transferPosition`; transfer reverts if that credit was spent or withdrawn.
- `bidRefundable` drift: the existing view is documented as floor-rounded and `bidEscrowed` / `quoteBidPrincipal` expose ceil-rounded escrow values.

## Rejected / Demoted

- ERC721 receiver-hook "custody drain": still rejected as unauthorized theft. During `onERC721Received`, the receiver is already the NFT owner, so claim/cancel/unwrap is owner authority rather than third-party drain. No reentrancy guard was added because the tested flows update ERC721 ownership before callbacks and downstream book authorization follows current ownership.
