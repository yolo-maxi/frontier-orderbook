# Gas

What operations actually cost — in gas, and in money. All numbers measured
with `forge test --isolate`: each operation is its own transaction
(intrinsic cost + cold storage + end-of-tx refunds — what a wallet pays,
excluding L2 data fees). Every benchmarked operation asserts its outputs,
so a benchmark cannot silently measure a no-op.

## What it costs

Pick a network (or set your own gas price and token price) and the table
prices every scenario:

<GasCostTable />

A few readings at the defaults: on Gnosis or Base, *everything* on this
page is fractions of a cent — limit-order trading at CEX granularity for
less than CEX fees would round to. On mainnet at ~0.5 gwei, a market order
runs a few tens of cents and a maker's full quote-claim lifecycle stays
under a dollar; even deploying an entire new market — a full order-book
contract — is in the ~$15 range, cheap enough to be ephemeral.

## Where the cost comes from

The unit of taker cost is the **maker order endpoint** — a tick where some
order starts or ends, i.e. where the aggregate ladder changes composition.
Each distinct endpoint crossed costs ~10–13k marginal. Everything between
two endpoints settles in one closed-form sum, no matter how many price
levels it spans — which is why the 500-level and 5,000-level sweeps in the
table cost nearly the same.

Three properties keep that unit honest:

- **Coincident endpoints merge.** Two makers quoting the same range share
  the same two endpoints — the sweep pays once. A hundred makers sharing a
  range cost exactly what one does (bit-exact: deposit/swap/claim are
  identical with 1 or 100 makers in the range). Cost scales with *distinct
  ranges crossed*, and only degrades to per-maker when nobody shares any
  edge.
- **Endpoints are paid for once, ever.** A sweep consumes the edges it
  crosses: their slots are zeroed (earning refunds) and the surviving
  liquidity is consolidated into a single edge at the stopping tick. The
  next taker through the same region pays for one consolidated edge, not
  the N that used to be there. A fragmented book defragments itself as it
  trades.
- **Empty distance is nearly free.** Price gaps cost one bitmap word read
  per 256 ticks. On the production `1.0001^tick` curve that's one word per
  ~2.6% price move — a sweep moving price 50% pays ~16 word reads (~40k)
  in traversal.

Maker operations are **width-independent**: a 100,000-tick ladder costs
within 12 gas of a 1,000-tick one (both touch the same two endpoint slots
plus one or two bitmap words). And there is no fragmentation tax over
time: a claim costs the same after 2 position lifecycles or 40.

Requotes and cancels execute in a delegatecalled companion module
(`FrontierMakerOps`) so the book fits EIP-170; the hop costs ~3–7k on
those operations and nothing on the hot swap path. Hooked books pay one
external call (~1–3k plus the hook's own logic) per flagged action;
hookless books are byte-identical to a system without hooks.

## Against per-level settlement

For reference, the same scenarios on a conventional per-level engine (the
pre-telescoping implementation, `test/PublishBench.t.sol` at both
commits): a 5,000-level sweep was 286.8M gas — about ten blocks,
unexecutable — versus 214,805 now, a **1,335× compression**. Fine ticks
went from the reason on-chain books die to costing nothing; the full
before/after matrix lives in the bench file.

## Methodology note

Intra-transaction `gasleft()` deltas (the usual Foundry pattern) measure
warm execution and understated standalone costs by up to 7× in our audit
(a bid claim looked like 6k; it's 50k as a transaction) — and overstated
sweeps, which earn refunds that intra-tx deltas never see. Width-equality
assertions use ±50 gas tolerance: calldata bytes differ across widths at
16 gas per nonzero byte.
