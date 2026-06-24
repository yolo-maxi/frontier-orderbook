# Hooks

A Uniswap-v4-style hook system: each book can bind one external contract
that gets called around the actions it cares about. Hooks turn the book
from a fixed venue into a platform — gated markets, price oracles, circuit
breakers, and incentive programs are all hook-sized, and several are
implemented and tested in this repo (see [the experiments](#the-experiments)
below).

## The contract surface

Six callbacks, defined in `IFrontierHooks`:

| Callback | Fires on | Can veto? |
|---|---|---|
| `beforeDeposit` | ask & bid ladder placement | **yes** — revert blocks it |
| `afterDeposit` | ask & bid ladder placement | observes |
| `beforeSweep` | every taker sweep (price move) | **yes** — revert blocks it |
| `afterSweep` | every taker sweep, with `(fromTick, reached, paid, received)` | observes |
| `afterClaim` | fill claims, both sides | observes |
| `afterCancel` | cancels (reports fills + refunded principal) | observes |

`before` hooks are veto points; `after` hooks are observation points with
exact settlement data. Since the book's price *only* moves through sweeps,
an `afterSweep` hook observes every price change the market will ever
have — that single property is what makes the oracle experiment below
possible.

## What makes the design trustworthy

- **Permissions live in the hook contract's address.** The low 6 bits
  encode which callbacks the hook receives. Capabilities are inspectable
  on-chain and immutable for a given book — bound at book creation via
  `factory.createGeoBookWithHooks` or `createGeoBookWithHooksAndFees`. A hook can't
  quietly acquire a veto it didn't launch with.
- **Unflagged callbacks are never called.** Not "called and ignored" —
  never dispatched. A hookless book (`hooks = address(0)`) executes
  byte-identically to a build without the hook system.
- **Callbacks must return their own selector** (the v4 convention), so a
  malformed hook bricks loudly, not silently.
- **Self-call skipping**: the book never calls a hook for actions the hook
  itself initiated — a lesson learned the hard way on the real v4 fork,
  encoded here from day one. A hook that manages its own positions can't
  recurse into itself.

The entire dispatch is four lines (`FrontierBookBase`):

```solidity
function _callHook(uint160 flag, bytes memory data, bytes4 expected) internal {
    address h = address(hooks);
    if (h == address(0) || !h.hasFlag(flag) || msg.sender == h) return;
    (bool ok, bytes memory ret) = h.call(data);
    if (!ok || ret.length < 32 || abi.decode(ret, (bytes4)) != expected) revert HookRejected();
}
```

`hasFlag` is a pure check on the address bits — the only state the
permission system has. Cancels and requotes run inside the delegatecalled
maker-ops companion (`UniformMakerOps` on the linear test book,
`GeometricMakerOps` on the production curve), so `afterCancel` fires from
the book's own address context like everything else; hooks never need to
know the companion exists.

Deploying a hook at a flag-carrying address uses CREATE2 salt mining,
exactly as in Uniswap v4 (tests shortcut with `deployCodeTo`).

```solidity
uint160 flags = FrontierHookFlags.BEFORE_DEPOSIT_FLAG | FrontierHookFlags.AFTER_SWEEP_FLAG;
// mine a CREATE2 salt so the hook's address carries `flags` in its low bits
factory.createGeoBookWithHooks(weth, usdc, 1, startTick, hookAddr);
```

Cost: one external call per flagged action — ~1–3k for the hop plus
whatever the hook's own logic does. Unflagged actions pay only the address
bit-check.

## The experiments

Four hooks live in `src/hooks/examples/`, each demonstrating a different
corner of the design space. All are tested in `test/Hooks.t.sol` and
`test/HookExperiments.t.sol`.

### Gated market — `GatedVolumeHook`

`beforeDeposit` as an access policy: an admin allowlist for makers
(KYC-style permissioned market) plus an `afterSweep` volume counter.
The original example: tests cover gating, observation, unflagged-callback
skipping, and that hookless books behave identically to before the hook
system existed.

### The book as its own oracle — `TwapOracleHook`

`afterSweep` alone is enough to make any book a v3-style TWAP oracle —
no keeper, no external feed, ~60 lines:

```solidity
function afterSweep(address, int24, int24 reached, uint256, uint256) external override returns (bytes4) {
    // accumulate tick × seconds since the last move, ring-buffer the observation
    cum = last.tickCumulative + int56(last.tick) * int56(uint56(t - last.blockTimestamp));
    observations[count % CARDINALITY] = Observation(t, reached, cum);
    ...
}
```

`consult(secondsAgo)` binary-searches the ring buffer and returns the
time-weighted average tick over any trailing window inside recorded
history. Because *every* price move flows through `afterSweep`, the
cumulative is exact — same-second moves collapse to the last one, as v3's
per-block observations do. Tests verify exact averaging across moves,
interpolation inside intervals, and lookback bounds.

Measured all-in cost to takers (`testTwapHookSweepOverhead`, `--isolate`):
**31,770 gas on the first sweep, 34,550 gas steady-state** — the call hop is ~2.5k and the rest is the
oracle's own storage (a fresh ring-buffer slot is a 20k zero→nonzero
write; once the 256-slot ring wraps, observations become ~5k overwrites
and the steady-state cost drops toward ~20k). On a typical 150–220k
sweep that's a 15–20% premium for a market that prices itself.

This is the foundation for anything that needs a manipulation-resistant
price: lending against book liquidity, settlement of derivatives on book
markets, or cross-checking another venue.

### A per-block speed bump — `SweepCircuitBreakerHook`

`beforeSweep` as a veto: the first sweep of each block pins a reference
tick, and any sweep targeting a price further than `maxMovePerBlock` from
it reverts.

Deliberately crude — it judges the taker's *stated target*, not the
realized fill — but it demonstrates that a `before` hook is a real control
point. The same shape builds circuit breakers with cooldowns, batch-auction
windows (veto all sweeps except in the last second of each minute), or
MEV speed bumps. Tests verify the cap binds, resets per block, and
re-pins to the current tick.

### Maker incentives without inflation games — `MakerMilesHook`

`afterClaim` + `afterCancel` as an incentive layer. The subtle insight:
fills only become *attributable* at settlement, and settlement reports
exact proceeds — so crediting there counts each filled wei exactly once,
no matter when the maker claims. Cancels credit only the filled part;
returned principal earns nothing, so parking unfilled size farms nothing.

`miles` is exact filled volume per maker, accumulated on-chain — an
incentive program converts it to rewards however it likes. Tests verify
claim credit equals claimed proceeds and that cancels split
filled-vs-refunded correctly.

## Composition

Hooks compose with everything else: a hooked book still has delegatable
permissions, uniform ladders, telescoped sweeps, and works through the
router. The hook surface is per-book, and books are cheap and parallel —
a gated, oracle-bearing, speed-bumped market can run *next to* the
unrestricted book for the same pair, and flow picks the venue it prefers.
