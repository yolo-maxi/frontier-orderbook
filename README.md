# Frontier — a thin-tick on-chain CLOB

Frontier is a standalone onchain central limit order book where user-facing ticks stay thin while settlement work is compressed. Taker sweeps cost O(order endpoints crossed), not O(ticks crossed), so dense thin-tick books remain executable.

Live demo: https://clob.repo.box

## Deploy-ready path

For real markets, use the fee-aware geometric deployment path:

- Contract family: `GeometricFrontierBook`
- Factory call: `FrontierGeoBookFactory.createGeoBookWithFees(...)`
- Deploy script: `prototype/script/DeployFrontier.s.sol`
- ABI guide: `docs/frontier-abi-interface.md`
- Agent operating guide: `skill.md`
- Generated JSON ABIs: `abi/*.json`

The deploy script accepts real token addresses, tick spacing, start tick, fee recipient, maker fee bps, and taker fee bps through env vars. Zero fees are supported.

## What's here

- `prototype/src/RollingFrontierBook.sol` — core two-sided book, endpoint-telescoped sweeps, shaped orders, O(1) deposit/requote/witness-claim paths, internal-balance recycling, transferable positions, hooks, and delegatable permissions.
- `prototype/src/GeometricFrontierBook.sol` — production-candidate geometric curve book.
- `prototype/src/FrontierGeoBookFactory.sol` — deploy-day geometric-only factory for fee-enabled real markets.
- `prototype/src/FrontierBookFactory.sol` — broader linear+geometric factory for tests and experiments; not the deploy-day path.
- `prototype/src/periphery/` — `FrontierRouter`, `FrontierLens`, `FrontierMakerKit`, and `RangeLP`.
- `prototype/src/permissions/` — selector-scoped, expirable delegation registry.
- `prototype/src/hooks/` — hook framework and examples. Do not use hooks in production without hook-specific review.
- `bots/` — market-maker and taker flow bots for the devnet/demo stack.
- `ui/` — trading UI served at clob.repo.box.

## The four ideas underneath

1. Rolling frontier: an order is two ledger deltas; fills consume the aggregate frontier and roll it. Deposits are O(1), and swaps avoid per-user work.
2. Prefix-contiguity: a valid order's fills are always a contiguous prefix of its range, so claims verify against one high-water mark.
3. Endpoint telescoping: between order endpoints the ladder is affine; whole runs settle via closed-form series.
4. Delegatable ownership: owner gates consult `PermissionRegistry`, so bots can manage positions while owners receive funds.

## Docs

Deploy-facing docs:

- `docs/frontier-abi-interface.md` — ABI and deploy reference.
- `skill.md` — agent guide for market creators, makers, takers, fees, delegation, and smoke tests.
- `skills.md` — compatibility pointer to `skill.md`.
- `prototype/FEES.md` — fee model notes.

Engineering/reference docs:

- `prototype/README.md` — prototype map and headline results.
- `prototype/DESIGN.md`, `prototype/IMPLEMENTATION.md`, `prototype/TESTING.md` — design, implementation, and proof notes.
- `prototype/PRICING.md` — ticks and prices.
- `prototype/EXPERIMENTS.md` — optional/experimental extensions.
- `requirements.md`, `invariants.md`, `test-plan.md`, `accounting-scenarios.md` — original specification package.

Historical experiment docs may mention prototypes, demos, hooks, yield, or future ideas. Treat `docs/frontier-abi-interface.md` and `skill.md` as the current deploy-facing source of truth.

## Build and test

```sh
cd prototype
forge build
forge test
```

Optional fork suite:

```sh
cd prototype
FORK=true forge test --match-contract Fork
```

## Deploy

```sh
cd prototype
DEPLOYER_KEY=... \
TOKEN0=0x... \
TOKEN1=0x... \
TICK_SPACING=60 \
START_TICK=0 \
FEE_RECIPIENT=0x... \
MAKER_FEE_BPS=0 \
TAKER_FEE_BPS=30 \
FOUNDRY_PROFILE=deploy forge script script/DeployFrontier.s.sol:DeployFrontier --rpc-url "$RPC_URL" --broadcast --verify
```

Before announcing a market, run the smoke-test checklist in `skill.md`.
