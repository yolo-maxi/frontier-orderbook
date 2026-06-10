# Accounting Scenarios

## Scenario A: Bob partial fill, then reversal

Initial state:

- current tick: `0`
- Bob deposits sell token0 order over `[1,100]`

Then:

- Alice buys upward through ticks `[1,2]`

Expected after fill:

- Bob has claimable token1 proceeds for `[1,2]`
- Bob has no active sell liquidity in `[1,2]`
- Bob still has active sell liquidity in `[2,100]`

Then:

- price moves back to `0`

Expected after reversal:

- Bob's claimable proceeds are unchanged
- Bob's `[1,2]` liquidity remains consumed
- Bob's `[1,2]` liquidity does not become active again
- Bob remains active only over `[2,100]`

## Scenario B: Bob, reversal, then Carol deposits

Initial sequence:

1. current tick: `0`
2. Bob deposits `[1,100]`
3. Alice consumes `[1,2]`
4. price returns to `0`
5. Carol deposits `[1,100]`

Expected state:

- Bob has claimable proceeds for old `[1,2]`
- Bob is active over `[2,100]`
- Carol is active over `[1,100]`
- Carol has no claim to Bob's old `[1,2]` proceeds

Interval-level active liquidity:

- `[1,2]`: Carol only
- `[2,100]`: Bob + Carol

If price then moves `0 -> 3`:

- `[1,2]` second fill belongs only to Carol
- `[2,3]` fill belongs to Bob and Carol pro-rata

## Scenario C: overlapping ranges

Initial state:

- Bob deposits `[1,100]`
- Eve deposits `[2,50]`

Then:

- price consumes `[1,3]`

Expected:

- `[1,2]` proceeds belong only to Bob
- `[2,3]` proceeds are shared between Bob and Eve pro-rata
- Bob remains active over unfilled remainder
- Eve remains active over unfilled remainder

## Scenario D: same range, same lifecycle

Initial state:

- Bob deposits liquidity `L` over `[1,100]`
- Eve deposits liquidity `3L` over `[1,100]` before any fill

Then:

- price consumes `[1,2]`

Expected:

- Eve receives 3x Bob's proceeds for `[1,2]`
- both positions lose the consumed `[1,2]` eligibility

## Scenario E: cancel after partial fill

Initial state:

- Bob deposits `[1,100]`
- price consumes `[1,2]`

Then:

- Bob cancels

Expected:

- Bob receives claimable proceeds for `[1,2]`
- Bob receives unfilled principal for `[2,100]`
- Bob has no active order remaining
- Bob receives no future proceeds from later movement through `[2,100]`
