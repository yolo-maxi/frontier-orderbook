# Ticks & Prices

## The production convention (Uniswap-compatible)

```
raw price  = 1.0001^tick                      (token1 per token0, raw units)
human      = 1.0001^tick × 10^(dec0 − dec1)
```

One tick = **1 basis point (0.01%)**. Sign flips with token ordering;
relative precision never does.

| Pair, ordering | Formula | Example |
|---|---|---|
| token0=WETH(18), token1=USDC(6) — Base | `USDC/ETH = 1.0001^t × 10¹²` | $4,000 → t ≈ **−193,379** |
| token0=USDC(6), token1=WETH(18) — mainnet | `USDC/ETH = 10¹² / 1.0001^t` | $4,000 → t ≈ **+193,379** |
| token0=WBTC(8), token1=USDC(6) — mainnet | `USDC/BTC = 1.0001^t × 10²` | $100,000 → t ≈ **+69,081** |

Precision at spacing 1: ETH at $4,000 quotes in **$0.40 steps** ($0.20
worst rounding); BTC at $100k in **$10 steps**. A 5% move crosses
`ln(1.05)/ln(1.0001) ≈ 488` ticks — which is why per-tick settlement was
the blocker, and endpoint telescoping is the fix.

## The uniform test curve

The broad correctness and gas suites still exercise `UniformFrontierBook`
directly on its linear base curve: `price = 1 + 0.001 × tick` in X18 raw
units. That path exists to test the shared frontier machinery without
geometric pow arithmetic; it is not the deploy script's production curve.

The production curve is implemented as `GeometricFrontierBook`: the same
machinery with `1.0001^tick` swapped in. Geometric sums **telescope** — a
uniform run over `[a, b)` settles as `L·(P(b) − P(a))/(P(s) − 1)`, one pow
per endpoint — so sweeps stay O(endpoints) and the gas behavior is
curve-independent. Because every span is a difference of the same
deterministic curve over a shared denominator, partial claims sum exactly
against ceil-rounded deposits: no rounding leak by construction.

`prototype/script/DeployFrontier.s.sol` deploys the geometric factory and
creates a geometric book through `createGeoBookWithFees`.

## Uniform vs Geometric books

Uniform books use constant-absolute tick spacing: each level is the same
linear distance from the next one. In the current test book that is
`price = 1 + 0.001 × tick`, so moving one tick always changes the raw price
by the same amount. That makes uniform books a natural fit for bounded
ranges such as prediction markets, where prices represent probabilities
between 0 and 1 and evenly spaced levels are easy to read as percentage
points or cents.

Geometric books use constant-percentage tick spacing:
`price = 1.0001^tick`, matching the Uniswap-v3 price convention. A one-tick
move is always about one basis point, so the absolute step grows with price.
That is the right shape for spot-token markets and other assets that move
over wide multiplicative ranges.

Mirror liquidity works on both book types. The pool accounting lives on the
shared book surface (`mirrorReserves`, `depositMirror`, `withdrawMirror`),
while zap rebalancing previews in `FrontierRouter` route through
`_quoteBuyMirrored` / `_quoteSellMirrored` into the lens. `FrontierLens`
probes `geoD()` to choose the geometric span math when the book is a
`GeometricFrontierBook`; otherwise it uses the uniform curve. That keeps the
preview curve-aware instead of assuming linear ticks.
