# Deployment

## Live demo (clob devnet)

- UI: https://clob.repo.box (static, served from the FRONT server)
- RPC: https://rpc-clob.repo.box (chain id 84009, 2s blocks, anvil with
  state persistence under pm2 `clob-devnet`, state in /home/xiko/clob-devnet)

TOPOLOGY: public DNS for *.repo.box points at the front server
(fran@204.168.190.248); this box publishes through it. The UI is static
files at /var/www/repo.box/subdomains/clob ON THE FRONT; the RPC is an SSH
reverse tunnel (pm2 `clob-rpc-tunnel`, front 127.0.0.1:43110 -> local
8547) behind the front's Caddy. The local Caddy entries on this box only
matter for loopback testing. clob.repo.box previously carried the
uniswap-tools mock book preview (port 43109) — replaced 2026-06-10, front
Caddyfile backed up (.bak.clob-full-*).
- Addresses: `deployments/latest.json` (also served at clob.repo.box/deployment.json)
- Bots on the box (pm2): `clob-mm-bot` quotes ETH-USDC at ±0.1% around the
  live Coinbase spot, requoting through a DELEGATED operator key
  (PermissionRegistry selector grants — the fast path never holds custody);
  fills force the owner-key settle path. `clob-taker-bot` sends randomized
  market orders through the FrontierRouter to generate flow.
- Deploy/redeploy: `./deploy-devnet.sh` (forge create + cast; forge script
  refuses to broadcast because the factory exceeds EIP-170 — see below).

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
