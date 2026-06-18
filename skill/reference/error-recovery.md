# Error recovery

The book and periphery revert with `require` strings; `PermissionRegistry` uses
custom errors. Map the message to a cause and a fix.

## Book / maker / taker revert strings

| Revert | Cause | Fix |
| --- | --- | --- |
| `"unaligned"` / `"unaligned target"` | Tick not a multiple of `tickSpacing` | Align ticks: `tick - (tick % spacing)`. |
| `"empty range"` | `lower >= upper` | Ensure `lower < upper`. |
| `"zero liquidity"` | `liquidity == 0` | Pass a positive `uint128`. |
| `"range not below price"` | Bid range above current tick | Use `depositBid` with `upper <= currentTick`, or place an ask. |
| `"not a bid"` / `"use bid methods"` | Ask/bid method on the wrong side | Use the bid (`*Bid`) variant for bids, ask variant for asks. |
| `"not live"` | Position already cancelled/closed | Read `positions(id).live`; don't act on dead positions. |
| `"nothing to claim"` | No filled proceeds yet | Check `claimable`/`bidClaimable` first; wait for fills. |
| `"not filled"` | Claim target beyond filled frontier | Lower the `claimTo` target or wait. |
| `"expired"` | `deadline < block.timestamp` | Use a future deadline (e.g. now + 300s). |
| `"bad target"` | Sweep target wrong side of current tick | `target > currentTick` to buy, `< ` to sell. |
| `"below min proceeds"` / `"insufficient output"` | Output < `minOut` (slippage) | Re-quote, widen slippage, or reduce size. |
| `"pull failed"` | Input transfer/approval failed | Approve the **input** token to the correct spender with enough allowance/balance. |
| `"transfer out failed"` / `"fill payout failed"` / `"payout failed"` | Output transfer failed | Check recipient and token; avoid non-standard ERC20s. |
| `"refund failed"` | Router refund of unspent input failed | Caller must accept the refund token. |
| `"approve failed"` | Router→book approval failed | Non-standard token; use normal ERC20s. |
| `"no book for pair"` | Router path has no book | Pass a valid `book` address / known pair. |
| `"2-hop paths only"` | Unsupported multi-hop length | Use a 2-token path. |

## Factory revert strings (market creation)

| Revert | Fix |
| --- | --- |
| `"bad tokens"` | `token0 != token1`, both non-zero. |
| `"bad ticks"` | `tickSpacing > 0` and `startTick % tickSpacing == 0`. |
| `"fee too high"` | Keep each fee `<= 1000` bps. |
| `"fee recipient required"` | Set a non-zero `feeRecipient` when fees > 0. |
| `"geo book deploy failed"` | Retry / check constructor args and gas. |

## PermissionRegistry custom errors

| Error | Cause | Fix |
| --- | --- | --- |
| `PermissionDenied` | Operator not authorized for the selector | Owner must `grant`/`grantSelectorBundle` first. |
| `PermissionExpired` | Grant expiry passed | Re-grant with a new expiry. |
| `InvalidSelector` | Empty/zero selector | Pass a real 4-byte selector. |
| `InvalidAddress` | Zero operator/target | Provide non-zero addresses. |
| `InvalidExpiry` | Expiry in the past | Use a future `uint48` timestamp. |
| `InvalidNonce` | EIP-712 nonce mismatch | Read `permissionNonce(user)` and rebuild. |
| `InvalidSignature` / `InvalidSignatureLength` | Bad permit signature | Re-sign with the correct domain/typehash. |
| `DeadlineExpired` | Permit deadline passed | Re-sign with a future deadline. |

## General recovery flow

1. **Read before retrying.** `positions(id)`, `claimable`/`unfilledPrincipal`,
   `currentTick`, `tickSpacing`, fee bps, and allowances tell you the real state.
2. **Simulate.** Use the MCP dry-run (`eth_call`) or `simulateContract` to see
   the revert without spending gas.
3. **Quotes go stale.** On slippage reverts, re-quote and resubmit; don't reuse
   old `minOut`.
4. **Idempotency.** `claim` is safe to retry; `cancel` is terminal — verify the
   position is still `live` before cancelling.
5. **Approvals.** Most `*failed`/`pull failed` errors are allowance/balance or
   non-standard-token problems. Stick to normal ERC20s.
