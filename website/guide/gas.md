# Gas

All numbers measured with `forge test --isolate`: each operation is its own
transaction (intrinsic cost + cold storage + end-of-tx refunds — what a
wallet pays, excluding L2 data fees). Mock-token transfers; real ERC-20s
add ~10–40k per transfer. Every benchmarked operation asserts its outputs,
so a benchmark cannot silently measure a no-op.

## The headline: settlement compression

Identical scenarios on the per-level engine vs endpoint-telescoped sweeps,
measured separately for each side of the book (`test/PublishBench.t.sol`,
run at the pre-telescoping commit and at HEAD):

| Ask-side dense sweep (buying up) | per-level (before) | telescoped (now) | |
|---|---|---|---|
| 1 maker, 50 levels | 2,213,326 | 169,088 | 13× |
| 1 maker, 500 levels | 21,934,536 | 169,853 | **129×** |
| 1 maker, 5,000 levels | 286,766,376 (≈10 blocks — unexecutable) | 214,805 | **1,335×** |
| 5 makers, 500 active levels | 21,430,170 | 219,473 | 98× |
| sparse (2 orders, 100k-tick gap) | 1,096,008 | 1,168,527 | — (bitmap already solved sparse) |

| Bid-side dense sweep (selling down) | per-level (before) | telescoped (now) | |
|---|---|---|---|
| 1 maker, 50 levels | 2,110,462 | 145,193 | 15× |
| 1 maker, 500 levels | 21,069,262 | 145,376 | **145×** |
| 1 maker, 5,000 levels | 278,295,022 (≈9 blocks — unexecutable) | 191,690 | **1,452×** |
| 5 makers, 500 active levels | 20,565,073 | 174,889 | 118× |
| sparse (2 bids, 100k-tick gap) | 1,109,168 | 1,157,296 | — (bitmap already solved sparse) |

The same holds on the production `1.0001^tick` curve
(`GeometricFrontierBook`, `test/GeoBook.t.sol`): 151,140 for a 50-level
sweep, 196,937 for 5,000 levels — fineness-independence is
curve-independent, one pow per run endpoint.

The irreducible settlement unit is the **maker order endpoint** (~10–13k
marginal): a sweep crossing 50 distinct makers' orders pays for 50
absorptions. Cost scales with maker count, never tick count; residual
growth is one bitmap word read per 256 ticks traversed.

## Maker operations (width-independent)

| Operation | Gas |
|---|---|
| deposit, flat ladder | 231,393 (one bitmap word) / 253,305 (two words; widths 1k–100k within 12 gas) |
| deposit, shaped / bid | 303,326 / 230,054–251,978 |
| requote (re-price in place, no token movement) | 112,915 |
| requote shaped / bid | 205,318 / 119,671 |
| witness claim / cancel | 69,455 / 92,576 |
| claim via on-chain binary search (width 1,000) | 53,533 (vs 52,384 with witness, same fills) |
| recycle filled bid → new ask (zero transfers) | 181,503 (vs 252,007 round-trip) |
| fragmentation canary (claim after 2 vs 40 lifecycles) | 74,255 — identical |

Requotes and cancels execute in a delegatecalled companion module
(`FrontierMakerOps`) so the book fits EIP-170 with room to spare; the hop
costs ~3–7k on those operations and nothing on the hot swap path.

User-count independence is bit-exact: deposit/swap/claim cost the same
with 1 or 100 makers sharing a range.

## Takers, per level crossed

The unit of cost is the maker **endpoint**, not the level. Marginal cost
per distinct maker order absorbed: **~13.3k** (198,987 for a 5-endpoint
sweep → 798,562 for 50). When levels belong to one order they collapse
into a single run: a 20-level sweep is 153,774 flat / 165,447 shaped /
129,640 bids as a whole transaction (≈7–8k per level, mostly fixed
overhead). Empty-gap traversal is one bitmap word per 256 ticks: 192,785
over 2,560 ticks; 2,682,647 over 256,000.

## Methodology note

Intra-transaction `gasleft()` deltas (the usual Foundry pattern) measure
warm execution and understated standalone costs by up to 7× in our audit
(a bid claim looked like 6k; it's 50k as a transaction) — and overstated
sweeps, which earn refunds that intra-tx deltas never see. Width-equality
assertions use ±50 gas tolerance: calldata bytes differ across widths at
16 gas per nonzero byte.
