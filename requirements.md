# Requirements

## R1. Venue agnostic

The mechanism should be specified independently of implementation venue.

Preferred compatibility order:

1. Uniswap v4 hook
2. Uniswap-compatible vault/periphery around a normal pool
3. Custom AMM/order pool with Uniswap-like interfaces
4. External accounting system that routes through Uniswap

A hook is a nice-to-have, not a requirement.

## R2. One-way range orders

Users must be able to place a sell order across a tick range:

- sell token0 for token1 over `[lowerTick, upperTick]`
- optionally, symmetric sell token1 for token0 over `[upperTick, lowerTick]`

When price moves through the range in the sell direction, the corresponding portion of the order is consumed.

## R3. Lazy proceeds collection

Sale proceeds should become claimable by the user later.

The user should not need to be touched during swap execution.

This is analogous to Uniswap fee collection:

- swaps update aggregate accounting
- users later claim their share

## R4. No per-user swap work

Swap execution must not loop over users.

If 1,000 users share the same range or tick interval, the swap path must operate on aggregate state, not individual user positions.

## R5. No resurrection after reversal

Consumed order liquidity must not become active again when price reverses.

Example:

- Bob sells over `[1,100]`
- price moves `0 -> 2`
- Bob's `[1,2]` is consumed
- price moves `2 -> 0`
- Bob's `[1,2]` remains consumed and claimable
- Bob must not sell `[1,2]` again unless he deposits fresh liquidity

## R6. New deposit freshness

A user depositing after a previous fill must not inherit previous proceeds.

Example:

- Bob deposits `[1,100]`
- `[1,2]` fills
- price returns to `0`
- Carol deposits `[1,100]`

Carol must be active over `[1,100]`, but Carol must not receive any proceeds from Bob's earlier `[1,2]` fill.

## R7. Partial-fill support

Range orders must support partial fills.

A partially filled order has:

- claimable proceeds for the filled portion
- still-active sell liquidity for the unfilled portion

## R8. Cancellation

A user should be able to cancel an order after partial fill.

Cancellation should return:

- claimable proceeds for already-filled portions
- unfilled principal for remaining portions

After cancellation, the position must not earn future proceeds.

## R9. Complexity goals

Required:

- swap cost must not scale with number of users
- deposit cost must not scale with number of existing users
- claim cost must not scale with number of other users

Desired but unproven:

- deposit cost independent of tick range width
- claim cost independent of tick range width

Acceptable:

- swap cost may scale with number of crossed initialized ticks, as in Uniswap
