# Frontier Prediction Market UI

The devnet UI at `https://clob.repo.box` is prediction-market oriented.

- Market shell: `Will ETH close above $2,000 on Friday?`
- YES is the live deployed Frontier CLOB adapter over the current ETH/USDC book in `public/deployment.json`.
- NO is a synthetic complement adapter (`NO = 1 - YES`) until a second deployed book address is added to the manifest.
- The UI displays dual books, implied probabilities, complement/overround checks, a live YES execution ticket, market-maker quoting, and adapted position exposure.

Build and deploy:

```sh
cd ui
pnpm run build
~/clawd/scripts/deploy.sh dist clob
```

`clob.repo.box` is served from the repo.box VPS (`fran@204.168.190.248`). If this
workspace is not that VPS, stage the built `dist/` on the VPS and run the same
deploy helper there before verifying the public URL.

Verification:

```sh
curl -s https://clob.repo.box/deployment.json
curl -s https://rpc-clob.repo.box -H 'content-type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}'
```
