# Range Take-Profit Order Book — Prototype

Working prototype for the requirements package in the parent folder
(`../requirements.md`, `../invariants.md`, `../test-plan.md`,
`../accounting-scenarios.md`): one-way range take-profit sell orders with
Uniswap-style lazy accounting — consumed liquidity never resurrects on price
reversal, later depositors never inherit earlier fills, and no operation
loops over users.

**Status (2026-06-10):** mechanism designed, built four ways (standalone
fill-clock book, naive reference oracle, real Uniswap v4 hook, and a
width-O(1) rolling-frontier book), and verified — 135 tests passing,
including the full spec scenario suite against all four implementations, 2,000-run differential fuzzing, gas proofs of the
complexity requirements, and an end-to-end Base mainnet fork test using the
deployed PoolManager, real WETH/USDC, and the deployed Universal Router.

## The design in three sentences

Ranges decompose into per-tick-spacing buckets; an upward crossing consumes
the *entire* bucket (liquidity zeroed), so no-resurrection holds by
construction. A single global fill clock plus one `depositClock` scalar per
position replaces all epoch machinery: an interval is consumed-for-you iff
`lastFillClock > depositClock`. Everything is O(1) in user count and
history depth; deposit/claim are O(range-width/spacing) — the accepted
compromise for the vanilla-hook venue. A second design — the
**rolling-frontier book** — achieves the spec's "desired" width-O(1)
deposit/claim/cancel by exploiting that a valid position's fills are always
a contiguous prefix of its range; it fits every venue except the
vanilla-real-liquidity hook (`DESIGN.md` has the correction story and the
trade-off).

## Documentation map

| Doc | Contents |
|---|---|
| [`DESIGN.md`](DESIGN.md) | Why this mechanism: the two simplifying observations, boundary semantics (Q6), dust policy (Q7), requirements coverage table, the width-O(1) impossibility claim and its correction — the rolling-frontier design (Q1–Q3), the v4 hook answer (Q4) |
| [`IMPLEMENTATION.md`](IMPLEMENTATION.md) | How it's built: contracts, state model, operation flows, v4 hook mechanics (noSelfCall, ERC-6909 settlement, boundary rule), Universal Router encoding facts, build config, known gaps |
| [`TESTING.md`](TESTING.md) | What's proven and how: suite-by-suite breakdown, measured gas tables, fork-test numbers, spec traceability matrix (I1–I14, S1–S5) |

## Layout

- `src/RangeTakeProfitBook.sol` — standalone production candidate (fill-clock design)
- `src/RollingFrontierBook.sol` — width-O(1) candidate (frontier deltas + witness claims)
- `src/RangeTakeProfitHook.sol` — the same mechanism as a real Uniswap v4 hook (+ `MarketSwapper`)
- `src/ReferenceBook.sol` — eager O(users) correctness oracle
- `src/IRangeOrderBook.sol` — shared interface that makes the three cross-testable
- `test/Scenarios.t.sol` — spec scenarios A–E + boundaries, one abstract suite run against ALL implementations
- `test/HookScenarios.t.sol` — that suite on a real PoolManager with real tick math
- `test/Differential.t.sol` — randomized differential fuzz (prod vs reference)
- `test/Gas.t.sol` — user-count independence, width scaling, fragmentation canary
- `test/FrontierScenarios.t.sol` / `FrontierDifferential.t.sol` / `FrontierGas.t.sol` — same suite + fuzz + width-flatness proofs for the frontier book
- `test/ForkBaseHook.t.sol` — Base mainnet fork: real PoolManager, real WETH/USDC, fills via the real Universal Router

## Run

```sh
forge test                                # everything local (fork tests skip)
forge test --match-contract GasTest -vv   # show gas measurements
FOUNDRY_FUZZ_RUNS=2000 forge test --match-test testFuzz_Differential
FORK=true forge test --match-contract ForkBaseHookTest -vv   # Base mainnet fork
# optional: BASE_RPC_URL=<url> to override the default Base RPC
```

## The thin-tick story (publishable summary)

User-facing ticks stay THIN — full price precision — while settlement work
is compressed. Mechanism in three sentences: between two order endpoints,
the active liquidity ladder is a straight line (constant per level, or
linear for shaped orders), so a taker sweep settles the whole run with one
closed-form sum instead of one state transition per tick. The sweep only
touches points where the book's composition actually changes (order
endpoints, found via bitmap), and writes survivors once at the end.
Freshness and no-resurrection are kept by recording one "this sweep covered
up to boundary H" entry per sweep — a position's filled prefix is just that
high-water mark clamped to its range, provable in O(log sweeps).

Before/after, same scenarios, real per-transaction gas (--isolate): a sweep
through 500 active thin levels fell from 21.9M gas (2/3 of a block) to
167k (131x); through 5,000 levels from 286.8M (unexecutable, ~10 blocks)
to 210k (1,367x). Payouts stay exact to the wei against brute-force
per-tick references; maxPay parks mid-run at the exact affordable thin
tick; user-count independence, freshness, and no-resurrection are all
test-pinned. Known limits: cost scales with distinct order ENDPOINTS
crossed (~10-13k each — maker count, not tick count), and bid-side
down-sweeps are not yet telescoped.

## Headline results

- All required complexity properties hold *exactly*: deposit/swap/claim gas
  is bit-identical with 1 vs 100 users sharing a range, and claims cost the
  same after 2 or 40 historical fill/reversal lifecycles.
- The hook passes the identical scenario suite as the standalone book, on a
  real PoolManager, driven by real swaps — including via the production
  Universal Router on a Base fork (502.47 real USDC filled against a real
  WETH ladder, claims exact to the formula, 2 wei dust).
- Bucket-book cost model: ~24k gas per interval at deposit, ~3.3k per
  interval scanned at claim. One wide position beats N single-interval
  positions ~3.3× on deposit gas.
- Frontier-book cost model: deposit 139,932 gas at width 10 / 1,000 /
  100,000 (bit-identical), witness-claim 28,350, witness-cancel 34,445 —
  the "desired but unproven" R9 property, proven.

## What's deliberately not here yet

Nonzero-fee pools for the v4 hook (needs a small per-fill record),
multi-pool hook instances, keeper/batch claiming (spec Q8, one-line change),
shaped bids (asks have shapes; the bid mirror is mechanical), sub-tick
partial fills (designed and parked — `NOTES-partial-fills.md`). See the gaps
sections in `IMPLEMENTATION.md` and `TESTING.md`.
