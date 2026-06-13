<div align="center">

# FRONTIER

**The order book is back onchain.**

A full central limit order book that lives on the chain — prices in tenths
of a cent, whole ladders in one transaction, fills that wait for you. No
operator; nothing to trust but the chain.

Created by **Francesco Renzi**

`source-available · research prototype · not for production use`

</div>

---

## What this is

Order books lost to AMMs onchain for one reason: every price level cost
gas, so fine-grained books were unexecutable — a 5,000-level sweep cost ten
blocks of gas. Frontier's **settlement compression** collapses any run of
levels into one closed-form update: that same sweep now costs ~**1,335×**
less, and tick fineness becomes free for takers.

What's left is what order books were always better at: real limit orders,
real price-time priority on a grid, depth you can see, and market making
that doesn't bleed against arbitrage by design.

> **Honesty note:** this repository is **source-available, not
> open-source.** You may read, fork, and evaluate it; you may **not** deploy
> it, run it in production, or use it commercially without written
> permission. See [`LICENSE`](LICENSE).

## The four ideas underneath

1. **Rolling frontier** — an order is two ledger deltas; fills consume the
   aggregate frontier and roll it. Deposits are O(1); swaps avoid per-user
   work.
2. **Prefix-contiguity** — a valid order's fills are always a contiguous
   prefix of its range, so claims verify against one high-water mark.
3. **Endpoint telescoping** — between order endpoints the ladder is affine;
   whole runs settle via a closed-form series.
4. **Delegatable ownership** — owner gates consult `PermissionRegistry`, so
   bots can manage positions while owners receive the funds.

## Architecture

| Area | What's here |
|---|---|
| **`prototype/`** | The Solidity. Core books, the deploy-ready geometric path, periphery (router/lens/maker-kit), the permission registry, and the hook framework. Foundry project. |
| **`ui/`** | The public frontend: a landing page **first**, then a live trading terminal (React + Vite + viem). This is what serves `clob.repo.box`. |
| **`bots/`** | Market-maker and taker flow bots for the devnet/demo stack. |
| **`website/`** | VitePress documentation site (guides, gas tables, brand). |
| **`abi/`**, **`docs/`** | Generated JSON ABIs and the deploy-facing ABI/interface reference. |

### Deploy-ready contract path

For real markets, the size-optimized geometric path (under EIP-170):

- Contract family: `GeometricFrontierBook`
- Factory call: `FrontierGeoBookFactory.createGeoBookWithFees(...)`
- Deploy script: `prototype/script/DeployFrontier.s.sol`
- ABI guide: `docs/frontier-abi-interface.md`
- Agent operating guide: `skill.md`

The deploy script accepts real token addresses, tick spacing, start tick,
fee recipient, and maker/taker fee bps via env vars. Zero fees are
supported.

### The frontend, landing-first

`ui/` opens on a narrative **landing page** — what Frontier is, how the
geometric frontier order book works, and why makers and arbers should care.
The live moving **terminal** is one click away (and at the `#trade` route).
The terminal reads a `deployment.json` manifest at load; with placeholder
(zero) addresses it shows an "awaiting config" state, so the landing page
is fully self-contained and always presentable.

## Quickstart

### Frontend (use pnpm)

```sh
cd ui
pnpm install
pnpm dev        # landing + terminal at localhost:5173
pnpm build      # static build into ui/dist
```

### Contracts (Foundry)

```sh
cd prototype
forge test                                 # everything local (fork tests skip)
forge test --match-contract GasTest -vv    # show gas measurements
FORK=true forge test --match-contract Fork # optional Base mainnet fork suite
```

> **Build note:** the default profile compiles via-IR at very high optimizer
> runs and is memory-hungry. On constrained machines, prime the cache with a
> couple of targeted `forge build --contracts <file>` calls before a full
> build.

### Deploy-path build (EIP-170 size profile)

```sh
cd prototype
FOUNDRY_PROFILE=deploy forge build --sizes
```

### Deploy a market (do not broadcast without intent)

```sh
cd prototype
DEPLOYER_KEY=... \
TOKEN0=0x... TOKEN1=0x... \
TICK_SPACING=60 START_TICK=0 \
FEE_RECIPIENT=0x... MAKER_FEE_BPS=0 TAKER_FEE_BPS=30 \
FOUNDRY_PROFILE=deploy forge script script/DeployFrontier.s.sol:DeployFrontier \
  --rpc-url "$RPC_URL" --broadcast --verify
```

Before announcing a market, run the smoke-test checklist in `skill.md`.

## Status

- Mechanism designed, **built four ways** (standalone fill-clock book, naive
  reference oracle, real Uniswap v4 hook, and a width-O(1) rolling-frontier
  book) and verified: **135 tests passing**, the full spec scenario suite
  against all implementations, 2,000-run differential fuzzing, gas proofs of
  the complexity requirements, and an end-to-end **Base mainnet fork** test.
- The geometric path is size-optimized to fit EIP-170 for real chains.
- This is a **research prototype**. It is **unaudited**. See
  [`SECURITY.md`](SECURITY.md).

## Docs

Deploy-facing: `docs/frontier-abi-interface.md`, `skill.md`,
`prototype/FEES.md`. Engineering: `prototype/{DESIGN,IMPLEMENTATION,TESTING,
PRICING}.md`. Specification package: `requirements.md`, `invariants.md`,
`test-plan.md`, `accounting-scenarios.md`. Treat
`docs/frontier-abi-interface.md` and `skill.md` as the current
deploy-facing source of truth.

## Contact

Created and maintained by **Francesco Renzi**.

**Interested in deploying Frontier on your chain? Please reach out.**
Production, deployment, and commercial use require written permission (see
[`LICENSE`](LICENSE)).

<!-- TODO(@fran-handle): replace with the verified public X/Twitter handle -->
- X/Twitter: `TODO(@fran-handle)`

## License

[Frontier Source-Available License v1.0](LICENSE) — view and evaluate
freely; **no use, deployment, or commercial use without written
permission.** Not an OSI open-source license.
