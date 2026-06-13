# Deployment

## Live demo (clob devnet)

The reference demo runs on a disposable devnet (anvil with state
persistence, 2s blocks) fronted by a static UI build and an RPC endpoint.
Infrastructure topology (hosts, tunnels, process managers) is intentionally
omitted from this public repository.

- UI: `https://clob.repo.box` — a static build of `../ui` (`pnpm build`).
- RPC: chain id `84009`, 2s blocks.
- Addresses: `deployments/latest.json`, also served next to the UI as
  `deployment.json` (the frontend fetches it at load).
- Bots: a market-maker bot quotes ETH-USDC at ±0.1% around the live spot,
  requoting through a **delegated operator key** (PermissionRegistry
  selector grants — the fast path never holds custody); fills force the
  owner-key settle path. A taker bot sends randomized market orders through
  the `FrontierRouter` to generate flow. See `../bots/`.
- Deploy/redeploy: `./deploy-devnet.sh` (forge create + cast; forge script
  refuses to broadcast the older factory because it exceeds EIP-170 — see
  below).

> The devnet runs with the contract size limit disabled. Demo keys are the
> well-known deterministic Anvil/Foundry test keys and control nothing of
> value — never reuse them on a real chain.

## Base Sepolia (ready, needs a funded key)

No funded testnet key exists on this machine (checked all .envs; faucets
are login-gated). Once any key holds ~0.05 Base Sepolia ETH:

    cd prototype
    RPC=https://sepolia.base.org DEPLOYER_KEY=0x... ./deploy-devnet.sh

KNOWN BLOCKER for real chains: `RollingFrontierBook` runtime code is
~24-44KB at current optimizer settings — above EIP-170. Production
hardening options (not yet done): split the book into core + external
libraries, lower optimizer runs for deploy profile, or factory-via-
CREATE2-pointer. The devnet runs with the size limit disabled.

## Demo price model

Both demo tokens are 18 decimals; the book's linear rate curve maps
price = 1 + 0.001 x tick USDC/WETH, so $4,000 = tick 3,999,000 and one
tick = $0.001 (ultra-thin: ±0.1% = ±4,000 ticks — showcasing that
endpoint-telescoped sweeps make tick fineness free for takers).
