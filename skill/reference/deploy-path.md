# Deploy path & market creation

## Deploy the venue (one-time)

Use `prototype/script/DeployFrontier.s.sol` with `FOUNDRY_PROFILE=deploy`. It
deploys `PermissionRegistry`, the geometric deployers, `FrontierGeoBookFactory`,
`FrontierLens`, `FrontierRouter`, then creates one fee-configured book and writes
a deployment JSON.

```sh
cd prototype
DEPLOYER_KEY=... \
TOKEN0=0x... TOKEN1=0x... \
TICK_SPACING=60 START_TICK=0 \
FEE_RECIPIENT=0x... MAKER_FEE_BPS=0 TAKER_FEE_BPS=30 \
FOUNDRY_PROFILE=deploy forge script script/DeployFrontier.s.sol:DeployFrontier \
  --rpc-url "$RPC_URL" --broadcast --verify
```

Optional env: `DEPLOY_NAME` (default `Frontier`), `DEPLOY_OUT`
(default `deployments/frontier-latest.json`), `FEE_RECIPIENT` (default deployer),
`MAKER_FEE_BPS`/`TAKER_FEE_BPS` (default 0).

The deployment JSON conforms to
[`../../docs/deployment-schema.json`](../../docs/deployment-schema.json). Persist
`registry`, `factory`, `lens`, `router`, `book`, tokens, spacing, and fees.

## Validate before creating a market

These mirror the factory's reverts; check them client-side first:

- `token0 != token1`, both real, non-zero ERC20s.
- `tickSpacing > 0`.
- `startTick % tickSpacing == 0`.
- `makerFeeBps <= 1000` and `takerFeeBps <= 1000`.
- `feeRecipient != address(0)` whenever either fee is non-zero.
- Token ordering is intended and documented.

`@frontier/sdk` exposes `MarketCreator.validate(params)` for exactly this.

## Create a market

```solidity
// Fee-enabled (recommended default: zero maker fee, simple taker fee)
address book = factory.createGeoBookWithFees(TOKEN0, TOKEN1, 60, 0, FEE_RECIPIENT, 0, 30);

// Zero-fee (bootstrapping / internal)
address book = factory.createGeoBook(TOKEN0, TOKEN1, 60, 0);
```

TypeScript:

```ts
const creator = new MarketCreator(FACTORY, { publicClient, walletClient, account });
const { book } = await creator.createMarketAndWait({
  token0, token1, tickSpacing: 60, startTick: 0,
  feeRecipient, makerFeeBps: 0, takerFeeBps: 30,
});
// `book` comes from the BookCreated event — persist it.
```

Do **not** use `createGeoBookWithHooks*` for production without a hook-specific
audit. The deploy script uses the hookless path.

## After creation — smoke test

Run [`safety-checklist.md`](safety-checklist.md) before announcing the market.
