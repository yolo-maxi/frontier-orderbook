# Frontier/CLOB devnet migration — 84009 → 84100 (Gnosis mainnet fork)

**Date:** 2026-06-11
**Done by:** Ocean/Fable (Sprawl ops), on the shared dev box.

## What moved

The shared devnet behind `rpc-clob.repo.box` is now an **anvil fork of Gnosis Chain
mainnet, chain id 84100** (custom id so wallets can't confuse it with real Gnosis 100).
The full Frontier/CLOB demo stack was redeployed to it and reseeded two-sided at the
live ETH price; `clob-mm-bot` / `clob-taker-bot` were restarted against it and are
quoting/trading normally.

## Why

Sprawl's game economy moved to REAL Superfluid continuous streams (real protocol
contracts + real USDCx), which only exist in Gnosis mainnet state — so the shared
devnet had to become a Gnosis mainnet fork. The CLOB suite came along so both projects
keep sharing one chain/RPC.

## New endpoints / config

- RPC: `https://rpc-clob.repo.box` (unchanged URL, now serves chain **84100**)
  - same chain is also exposed as `https://rpc-sprawl.repo.box`
  - local on the box: `http://127.0.0.1:8548` (pm2 `sprawl-gnosis-fork`,
    state-persisted in `/home/xiko/sprawl-gnosis-fork/`)
- Addresses: `deployments/latest.json` (also served at `clob.repo.box/deployment.json`)
  — ALL contract addresses changed; book seeded at tick 1680125 (~$1681).
- Faucet key: **unchanged** (anvil #4, same as before).
- Deployer: anvil #0, same as before. MockERC20 WETH/USDC redeployed (fresh balances —
  everyone needs to re-mint/re-faucet).

## Old chain (84009)

- Final state: **still running locally** on the box at `http://127.0.0.1:8547`
  (pm2 `clob-devnet`, state file `/home/xiko/clob-devnet/state`). It is no longer
  publicly routed. It stays up until Fran confirms shutdown; after that the state
  file is the archive.
- The last 84009 address book is preserved at `deployments/84009-frontier-final.json`.

## Changes made to this repo

- `deploy-devnet.sh`: updated to HEAD constructors — `FrontierBookFactory` now takes
  the four deployer helpers (`RollingBookDeployer`, `MakerOpsDeployer`,
  `GeometricBookDeployer`, `GeometricOpsDeployer`) and `FrontierRouter` takes
  `(factory, lens)`. The previous script predated the two-level-bitmap/geometric
  refactor and could not deploy HEAD.

## What the Frontier team should verify

Deployed + smoke-tested only (mm-bot requotes, taker market orders, permission
grants). NOT verified by the migration: the two-level tick bitmap and partial-fill
paths under load, geometric books (none created), RangeLP/yield-vault flows, and any
tick math against the new seed price. Run your own test pass against
`https://rpc-clob.repo.box` and flag anything odd — the fork can be re-deployed
cheaply, old state stays available.
