# Hooks

A Uniswap-v4-style hook system, with the properties that make v4's design
trustworthy:

- **Permissions live in the hook contract's address.** The low 6 bits
  encode which callbacks the hook receives (`beforeDeposit`,
  `afterDeposit`, `beforeSweep`, `afterSweep`, `afterClaim`,
  `afterCancel`). Capabilities are inspectable on-chain and immutable —
  bound at book creation via `factory.createBookWithHooks`.
- **Callbacks must return their own selector** (a malformed hook bricks
  loudly, not silently).
- **Self-call skipping**: the book never calls a hook for actions the hook
  itself initiated — a lesson learned the hard way on the real v4 fork,
  encoded here from day one.
- Reverting in a `before` hook blocks the action; `after` hooks observe.

```solidity
uint160 flags = BEFORE_DEPOSIT_FLAG | AFTER_SWEEP_FLAG;
// deploy the hook at an address carrying `flags` (CREATE2 mining, as in v4)
factory.createBookWithHooks(weth, usdc, 1, startTick, hookAddr);
```

The example `GatedVolumeHook` allowlists makers (KYC-style gating) and
records sweep volume. Tests cover gating, observation, unflagged-callback
skipping, and that hookless books behave byte-identically to before the
system existed.

Hooks compose with everything else: a hooked book still has delegatable
permissions, shaped orders, telescoped sweeps.
