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
