# Ticks → Prices: USDC/ETH and USDC/BTC, precision, and why thin ticks are now free

Concrete reference for the announcement. All ticks below are computed, not
estimated, under the standard Uniswap convention we adopt for production:

```
raw price = token1-units per token0-unit = 1.0001^tick
human price (token1 per token0) = 1.0001^tick × 10^(decimals0 − decimals1)
```

One tick = a factor of 1.0001 ≈ **0.01% (1 basis point)**. The sign of a
given price's tick flips with token ordering (which token's address is
lower → token0); **relative precision does not** — a tick is 1bp regardless
of ordering or decimals.

## ETH/USDC

**Base ordering — token0 = WETH (18 dec), token1 = USDC (6 dec)**
(WETH `0x4200…` < USDC `0x8335…`):

```
USDC per ETH = 1.0001^tick × 10^12
$4,000  →  tick ≈ −193,379
```

(Sanity anchor: our Base mainnet fork test initialized at tick −198,000,
which is exactly $2,520/ETH under this formula.)

**Mainnet ordering — token0 = USDC (6), token1 = WETH (18)**
(USDC `0xA0b8…` < WETH `0xC02a…`):

```
USDC per ETH = 10^12 / 1.0001^tick
$4,000  →  tick ≈ +193,379
```

Same magnitude, opposite sign — ordering only mirrors the axis.

## BTC/USDC

**Mainnet ordering — token0 = WBTC (8), token1 = USDC (6)**
(WBTC `0x2260…` < USDC `0xA0b8…`):

```
USDC per BTC = 1.0001^tick × 10^2
$100,000  →  tick ≈ +69,081
```

## Precision at spacing 1 (thin ticks)

| | one tick (0.01%) | worst rounding (half tick, 0.005%) |
|---|---|---|
| ETH at $4,000 | **$0.40** | $0.20 |
| BTC at $100,000 | **$10** | $5 |

That is CEX-grade limit-order precision. Coarsening to spacing 10 would cut
crossings 10× but degrade steps to 0.1% ($4 on ETH, $100 on BTC) — visibly
worse than any serious venue.

## Why this used to be a gas problem, and isn't anymore

A 5% price move at spacing 1 crosses `ln(1.05)/ln(1.0001) ≈ 488` ticks
(a 1% move ≈ 100). With per-level settlement (~46k gas/level), 488 active
thin levels cost ~22M gas — two-thirds of a block — which forced the old
trade: thin ticks for precision OR coarse ticks for gas.

Endpoint-telescoped sweeps remove the trade. Settlement work scales with
**order endpoints crossed**, not ticks crossed: one maker ladder spanning
all 488 levels is ONE endpoint and settles as one closed-form run. Measured
(isolate mode, identical scenarios, before → after):

| Dense sweep | per-level | telescoped |
|---|---|---|
| 500 thin levels, 1 maker | 21,934,544 | **167,340** (131×) |
| 5,000 thin levels, 1 maker | 286,766,384 (unexecutable) | **209,817** (1,367×) |
| 500 levels, 5 makers | 21,430,170 | **214,412** |

So at spacing 1 on ETH/USDC: a $200 move (5%) through a fully quoted book
costs a taker roughly two Uniswap swaps' worth of gas, while makers keep
$0.40-step price control. The residual scaling is ~10–13k per distinct
maker order crossed (maker count, not tick count) plus one bitmap word read
per 256 ticks traversed.

Note on the prototype curve: the deployed prototype uses a linear
placeholder rate curve for test legibility; the tick→price convention above
is the production target (geometric, Uniswap-compatible). The endpoint-sweep
gas behavior is curve-independent — switching to `1.0001^tick` turns the
run formulas from quadratic into arithmetico-geometric series, both
closed-form (see DESIGN.md / NOTES-endpoint-sweeps.md).
