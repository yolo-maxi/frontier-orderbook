# Copy Liquidity Port

## Decision

Chosen path: **B, adapt the zap router functions to main's existing `UniformFrontierBook` shadow implementation.**

Main already had the core copy-liquidity accounting surface: `shadowReserves()`, `depositShadow()`, `withdrawShadow()`, `shadowSharesOf()`, and shadow-aware taker sweeps. The experiment branch's zap path was typed against `RollingFrontierBook`, which is not present on main and came with unrelated/destructive changes such as deleting the sqrt liquidity files and rewriting lens code. The clean port is therefore to reuse main's book/accounting implementation and add only the missing recipient-crediting deposit hook plus the router zap surface.

## Files Changed

- `src/UniformFrontierBook.sol`
  - Added `depositShadowFor(...)` delegatecall forwarder.
  - Removed unused named return vars on cancel forwarders and made `rateAt` `pure` to clear compiler warnings.
- `src/UniformMakerOps.sol`
  - Refactored direct shadow deposits through `_depositShadow(...)`.
  - Added `depositShadowFor(recipient, ...)`, where the caller pays and the recipient receives shares.
- `src/periphery/FrontierRouter.sol`
  - Added `ZapResult`, `CopyLiquidityZap`, `previewZapDepositShadow(...)`, and `zapDepositShadow(...)`.
  - Added held-token buy/sell helpers so zaps can rebalance already-pulled funds.
  - Added shadow-aware quote/prep helpers that account for taker fees and shadow mirror fills before previewing shares.
- `test/FrontierZap.t.sol`
  - Added unit, fuzz, simulation, and invariant coverage for the copied liquidity zap path.
- `foundry.toml`
  - Changed default optimizer runs to `200` so plain `forge build --sizes` checks deployable bytecode under the Base/EIP-170 size limit.
- `src/permissions/PermissionRegistry.sol`, `test/Invariants.t.sol`, `test/Periphery.t.sol`
  - Warning/format cleanup only.

## Correctness Notes

- `previewZapDepositShadow(...)` and `zapDepositShadow(...)` share the same preparation path; successful execution is asserted to match preview exactly.
- Zaps rebalance only the heavy side, then call `depositShadowFor(...)`; unused dust is refunded to the caller.
- Empty first shadow pools still require both assets. One-sided first deposits revert instead of minting a ratio from a swap.
- Zero amount inputs, insufficient swap output, insufficient shares, and zero recipient execution are guarded.
- Shadow quote simulation mirrors the book's real-plus-shadow sweep behavior and includes taker fee and shadow fee effects before calculating shares.
- Tests assert router dust is zero after zaps, reserves are solvent after swaps/withdrawals, no free shares are minted on max-uint preview, and final multi-actor withdrawal drains reserves and total shares to zero.

## Test Coverage

- Unit coverage:
  - `depositShadowFor` credits recipient and withdraws correctly.
  - Balanced zap with no swap.
  - Quote-heavy zap and outcome-heavy zap rebalance through the book.
  - 30 bps taker-fee zaps in both directions, with exact preview/execution parity, token conservation, fee charging, router dust checks, and reserve solvency.
  - Guard failures for swap/slippage/share/zero amount cases.
  - Small one-sided fee-bearing swap budgets revert as insufficient shares instead of underflowing in gross-budget math.
  - Empty pool first deposit behavior.
  - 1 wei and sequential deposits with rounding-bounded withdrawal.
  - Max-uint preview guard.
- Fuzz coverage:
  - `testFuzz_PreviewMatchesActual` verifies preview/result equality across balanced and one-sided inputs.
  - `testFuzz_TakerFeePreviewMatchesActual` verifies exact preview/result equality and conservation with 30 bps taker fees on one-sided inputs.
- Simulation coverage:
  - Multi-actor flow: seed copy liquidity, two users zap from opposite sides, takers sweep, makers quote, users and seed LP withdraw, final reserves and shares are zero.
- Invariant coverage:
  - Shadow reserves remain backed by book token balances.
  - Total shadow shares equal seeded LP shares plus tracked handler shares.
  - Active/bid liquidity reads across the seeded range do not underflow after handler actions.

## Gates

Commands were run from `prototype/`.

`forge build`

```text
Compiler run successful!
```

Foundry still prints repo-wide lint advisories/non-fatal warnings; the Solidity compiler build succeeded after the changed-file warning cleanup.

`forge test`

```text
Ran 41 test suites in 27.21s (98.60s CPU time): 258 tests passed, 0 failed, 2 skipped (260 total tests)
```

`forge test --match-contract Zap -vvv`

```text
Ran 1 test suite in 2.60s (2.59s CPU time): 13 tests passed, 0 failed, 0 skipped (13 total tests)
```

`forge test --match-contract Zap --match-test testFuzz --fuzz-runs 10000 -vv`

```text
[PASS] testFuzz_PreviewMatchesActual(uint96,uint96,uint8) (runs: 10001, μ: 1933273, ~: 2075974)
[PASS] testFuzz_TakerFeePreviewMatchesActual(uint96,bool) (runs: 10000, μ: 9034695, ~: 9073070)
2 passed
```

`forge test --match-contract CopyLiquidityInvariant -vv`

```text
[PASS] invariant_shadowAggregatesDoNotUnderflow() (runs: 10000, calls: 10000, reverts: 0)
[PASS] invariant_shadowReservesAreSolvent() (runs: 10000, calls: 10000, reverts: 0)
```

`forge test --gas-report`

```text
Ran 41 test suites in 44.03s (127.51s CPU time): 255 tests passed, 0 failed, 2 skipped (257 total tests)
```

Focused zap gas from `forge test --match-contract Zap --gas-report`:

```text
FrontierRouter.previewZapDepositShadow: min 991, avg 632259, median 704011, max 744041, calls 264
FrontierRouter.zapDepositShadow: min 138012, avg 924207, median 1006879, max 1046076, calls 266
UniformFrontierBook.depositShadowFor: 187529
UniformMakerOps.depositShadowFor: avg 38333, max 161793
```

`forge build --sizes`

```text
FrontierRouter: runtime 10026 B, init 10230 B, runtime margin 14550 B
UniformFrontierBook: runtime 21608 B, init 22706 B, runtime margin 2968 B
GeometricFrontierBook: runtime 22179 B, init 24177 B, runtime margin 2397 B
UniformMakerOps: runtime 11110 B
GeometricMakerOps: runtime 11699 B
```

All modified contracts are under the 24576 byte EIP-170 runtime limit with the default size-safe optimizer profile.

## Blockers

None.
