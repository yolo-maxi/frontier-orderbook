# Gas

All numbers measured with `forge test --isolate`: each operation is its own
transaction (intrinsic cost + cold storage + end-of-tx refunds — what a
wallet pays, excluding L2 data fees). Mock-token transfers; real ERC-20s
add ~10–40k per transfer. Every benchmarked operation asserts its outputs,
so a benchmark cannot silently measure a no-op.

## The headline: settlement compression

Identical scenarios on the per-level engine vs endpoint-telescoped sweeps:

| Dense thin-tick sweep | per-level (before) | telescoped (now) | |
|---|---|---|---|
| 1 maker, 50 levels | 2,213,334 | 166,738 | 13× |
| 1 maker, 500 levels | 21,934,544 | 167,340 | **131×** |
| 1 maker, 5,000 levels | 286,766,384 (≈10 blocks — unexecutable) | 209,817 | **1,367×** |
| 5 makers, 500 active levels | 21,430,170 | 214,412 | 100× |
| sparse (2 orders, 100k-tick gap) | 1,096,008 | 1,110,572 | — (bitmap already solved sparse) |

The irreducible settlement unit is the **maker order endpoint** (~10–13k
marginal): a sweep crossing 50 distinct makers' orders pays for 50
absorptions. Cost scales with maker count, never tick count; residual
growth is one bitmap word read per 256 ticks traversed.

## Maker operations (width-independent)

| Operation | Gas |
|---|---|
| deposit, flat ladder | 228,913 (one bitmap word) / 250,825 (two words; widths 1k–100k within 12 gas) |
| deposit, shaped / bid | 296,214 / 228,054–249,978 |
| requote (re-price in place, no token movement) | 104,053 |
| requote shaped / bid | 189,565 / 116,505 |
| witness claim / cancel | 65,956 / 85,697 |
| claim via on-chain binary search (width 1,000) | 73,434 |
| recycle filled bid → new ask (zero transfers) | 181,891 (vs 251,057 round-trip) |
| fragmentation canary (claim after 2 vs 40 lifecycles) | 70,756 — identical |

User-count independence is bit-exact: deposit/swap/claim cost the same
with 1 or 100 makers sharing a range.

## Takers, per level crossed

~46k flat asks · ~61k shaped asks · ~44k bids (20-level sweeps including
fixed overhead) — but remember these collapse into per-*endpoint* costs
when levels belong to the same order. Empty-gap traversal: 161,806 over
2,560 ticks; 2,513,068 over 256,000.

## Methodology note

Intra-transaction `gasleft()` deltas (the usual Foundry pattern) measure
warm execution and understated standalone costs by up to 7× in our audit
(a bid claim looked like 6k; it's 50k as a transaction) — and overstated
sweeps, which earn refunds that intra-tx deltas never see. Width-equality
assertions use ±50 gas tolerance: calldata bytes differ across widths at
16 gas per nonzero byte.
