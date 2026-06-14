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
- Deploy/redeploy: `FOUNDRY_PROFILE=deploy forge script
  script/DeployFrontier.s.sol:DeployFrontier --rpc-url <RPC> --broadcast`
  (the geometric book is under EIP-170, so forge script broadcasts directly
  — see below). The old `deploy-devnet.sh` linear path is archived on
  `archive/rolling-frontier-book`.

## Base Sepolia (ready, needs a funded key)

No funded testnet key exists on this machine (checked all .envs; faucets
are login-gated). Once any key holds ~0.05 Base Sepolia ETH:

    cd prototype
    RPC_URL=https://sepolia.base.org DEPLOYER_KEY=0x... \
      TOKEN0=0x... TOKEN1=0x... TICK_SPACING=60 START_TICK=0 \
      FOUNDRY_PROFILE=deploy forge script \
      script/DeployFrontier.s.sol:DeployFrontier --rpc-url "$RPC_URL" --broadcast

EIP-170 status: the deployed `GeometricFrontierBook` runtime is ~21.7KB,
under the EIP-170 24,576-byte limit (~2.8KB headroom), built with
`FOUNDRY_PROFILE=deploy`. The production deploy path is
`script/DeployFrontier.s.sol` (geometric); it broadcasts on real chains
without disabling the size limit.

## Demo price model

The old linear demo path (`DeployDemo.s.sol`, `deploy-devnet.sh`) has been
removed; the demo/linear book is archived on `archive/rolling-frontier-book`.
The current deploy path is `DeployFrontier.s.sol` (geometric), which prices
levels on the `1.0001^tick` curve.
