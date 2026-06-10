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

## The demo curve

The devnet uses a linear placeholder for legibility: both tokens 18
decimals, `price = 1 + 0.001 × tick` USDC/WETH. So $1,628.61 = tick
1,627,605 and one tick = **$0.001** — deliberately absurdly thin
(±0.1% ≈ ±1,630 ticks) to showcase that fineness is free. Swapping in the
geometric curve turns the run series from quadratic into
arithmetico-geometric; both are closed-form, and the gas behavior is
curve-independent.
