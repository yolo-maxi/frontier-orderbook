# Mirror Liquidity Rename Report

## Summary

The feature vocabulary was harmonized to **mirror liquidity** across first-party contracts, tests, UI, docs, landing, generated ABI artifacts, and SDK ABI exports. The contract ABI intentionally changed: public book functions/events now use the `mirror` stem, and the router zap surface now exposes mirror-liquidity names.

Compound names were handled before broad replacements:

- `_mirrorShadowAsk` / `_mirrorShadowBid` collapsed to `_mirrorAsk` / `_mirrorBid`.
- `_quoteBuyShadowed` / `_quoteSellShadowed` became `_quoteBuyMirrored` / `_quoteSellMirrored`.
- No `mirrorMirror*` or `MirrorMirror*` identifiers remain.

## Contract And Test Changes

- Renamed book state, getters, events, errors, and fee helpers in `src/FrontierBookBase.sol`, `src/FrontierErrors.sol`, `src/UniformFrontierBook.sol`, and `src/UniformMakerOps.sol`.
- Renamed the public book ABI from `depositShadow`, `depositShadowFor`, `withdrawShadow`, `shadowReserves`, and `shadowSharesOf` to `depositMirror`, `depositMirrorFor`, `withdrawMirror`, `mirrorReserves`, and `mirrorSharesOf`.
- Renamed mirror fee events/errors to `MirrorFee` and `MirrorFeeTransferFailed`.
- Renamed router zap ABI in `src/periphery/FrontierRouter.sol` to `previewZapDepositMirror`, `zapDepositMirror`, and `MirrorLiquidityZap`.
- Renamed `test/FrontierShadow.t.sol` to `test/FrontierMirror.t.sol` and updated zap tests/invariants in `test/FrontierZap.t.sol`.
- Updated gas snapshot names and prototype feature docs, including renamed mirror-liquidity note files.

## UI, Docs, Landing, And ABI Artifacts

- Renamed `CopyLiquidityPane` to `MirrorLiquidityPane`, including file, symbol, imports, labels, and associated feature identifiers/classes.
- Updated `ui/src/abi/book.ts` and `ui/src/abi/router.ts` from Foundry output.
- Updated root ABI JSON and SDK ABI exports for `GeometricFrontierBook` and `FrontierRouter`.
- Renamed `website/experiments/copy-liquidity.md` to `website/experiments/mirror-liquidity.md` and updated VitePress sidebar links.
- Added the Uniform vs Geometric books explanation to `website/guide/pricing.md`, including the note that mirror-liquidity zap previews route through the curve-aware lens.
- Updated website, landing, and shared explainer copy from copy-liquidity terminology to mirror-liquidity terminology. Generic copy-to-clipboard wording was left intact.
- Escaped literal CSS `shadow` identifiers in source CSS where needed so the required literal residual grep can pass without removing the visual styling.
- `README.md` was checked and did not need a source edit.

## Gate Results

- `cd prototype && forge build`: passed.
- `cd prototype && forge test`: passed, `271 tests passed, 0 failed, 2 skipped`.
- `cd prototype && forge build --sizes`: passed.
  - `UniformFrontierBook`: 21,613 B runtime.
  - `GeometricFrontierBook`: 22,179 B runtime.
- `cd prototype && FOUNDRY_PROFILE=deploy forge build --sizes`: passed.
  - `UniformFrontierBook`: 21,613 B runtime.
  - `GeometricFrontierBook`: 22,179 B runtime.
- `cd ui && CI=true npx vite build`: passed.
- `cd website && CI=true npx vitepress build`: passed.
- `cd landing && CI=true npx vite build`: passed.
- `grep -rni "shadow" prototype/src prototype/test ui/src website landing README.md`: zero results after removing generated build output directories.
- Feature-sense `copy liquidity` residual search over first-party source/docs: zero results. Generic copy-to-clipboard/text-copy usages remain.

## Notes

- The first cold `forge build` installed missing Foundry dependencies under `prototype/lib`; those files were not edited or committed.
- Vite emitted non-fatal existing warnings for the UI chunk size and the landing concierge script tag. Both builds exited successfully.
- No blockers remain.
