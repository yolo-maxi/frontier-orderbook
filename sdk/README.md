# @frontier/sdk

TypeScript SDK for the **Frontier** on-chain order-book + prediction-market venue.

Frontier is a thin-tick on-chain CLOB built on range orders. This SDK ships:

- **Typed ABI wrappers** for every deploy-day contract (`GeometricFrontierBook`,
  `FrontierGeoBookFactory`, `FrontierRouter`, `FrontierLens`, `PermissionRegistry`),
  generated from the canonical `abi/*.json` and shipped as `as const` for full
  viem type inference.
- **Helper classes**: `MarketCreator`, `MakerAgent`, `TakerAgent`,
  plus lower-level `BookClient`, `LensClient`, `PermissionClient`, `Erc20Client`.
- **Pure utilities** for slippage, fee math, tick/price conversion, and tick
  alignment.

Built on [viem](https://viem.sh). Node >= 22.

## Install

```sh
pnpm add @frontier/sdk viem
```

## Mental model

- `token0` is the base asset, `token1` the quote asset.
- **Asks** sell `token0` for `token1` over a range strictly above the current tick.
- **Bids** buy `token0` with `token1` over a range at or below the current tick.
- A position covers a half-open tick range `[lower, upper)`; ticks must be
  aligned to `tickSpacing`.
- The geometric book prices levels on the `1.0001^tick` curve.
- Always **quote → apply slippage → submit** for taker swaps.

## Quick start

```ts
import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { MarketCreator, MakerAgent, TakerAgent } from "@frontier/sdk";

const account = privateKeyToAccount(process.env.PK as `0x${string}`);
const publicClient = createPublicClient({ transport: http(process.env.RPC_URL) });
const walletClient = createWalletClient({ account, transport: http(process.env.RPC_URL) });
const opts = { publicClient, walletClient, account };

const FACTORY = "0x..." as const;
const ROUTER = "0x..." as const;
const LENS = "0x..." as const;
```

### Create a market

```ts
const creator = new MarketCreator(FACTORY, opts);

const { book } = await creator.createMarketAndWait({
  token0: "0x...",
  token1: "0x...",
  tickSpacing: 60,
  startTick: 0,
  feeRecipient: "0x...",
  makerFeeBps: 0,
  takerFeeBps: 30,
});
// `book` is the GeometricFrontierBook address — persist it.
```

`MarketCreator.validate(params)` runs the same checks the contract enforces
(distinct non-zero tokens, positive spacing, aligned start tick, fee caps, fee
recipient required when fees are non-zero) so you fail fast before paying gas.

### Make markets

```ts
const maker = new MakerAgent(book, opts);

// Sell token0 above current price. Approves token0 then deposits.
const { lower, upper } = await maker.askRangeAbove(1, 10); // 1 spacing above, 10 wide
const askTx = await maker.placeAsk(lower, upper, 1_000_000_000_000_000_000n);

// Buy token0 below current price. You supply the token1 budget to approve.
const bid = await maker.bidRangeBelow(1, 10);
const bidTx = await maker.placeBid(bid.lower, bid.upper, 1n * 10n ** 18n, quoteBudget);

// Lifecycle (positionId from the Deposit event / your store)
const proceeds = await maker.claimable("ask", positionId); // net of maker fee
await maker.claim("ask", positionId);
await maker.cancel("ask", positionId);
```

`placeAsk` / `placeBid` validate that the range is spacing-aligned, ordered, and
on the correct side of the current tick before sending.

### Take liquidity

```ts
const taker = new TakerAgent(ROUTER, LENS, opts);

// Buy token0 with 1000 token1, 0.5% slippage (auto-quoted), router refunds dust.
const buyTx = await taker.buy(book, {
  amountIn: 1000n * 10n ** 18n,
  minOut: 0n,        // 0 => auto-quote + slippageBps
  slippageBps: 50,
});

// Or compute minOut yourself from an explicit quote:
const q = await taker.quoteBuy(book, amountIn);
await taker.buy(book, { amountIn, minOut: (q.amountOut * 9950n) / 10000n });
```

`TakerAgent` quotes through the lens, applies slippage, and approves the router
for the input amount **plus** the taker fee before executing.

### Delegate to a bot

```ts
import { PermissionClient, BOOK_SELECTORS } from "@frontier/sdk";

const perms = new PermissionClient(REGISTRY, opts);
const oneDay = BigInt(Math.floor(Date.now() / 1000) + 86_400);

await perms.grantBundle(
  agentAddress,
  book,
  [BOOK_SELECTORS.claim, BOOK_SELECTORS.cancel, BOOK_SELECTORS.requote],
  oneDay,
);
```

`BOOK_SELECTORS` are verified against the bundled ABI in the test suite.

### Raw typed ABIs

```ts
import { abi } from "@frontier/sdk";
// abi.geometricFrontierBookAbi, abi.frontierRouterAbi, ...
```

Or via the subpath: `import { frontierLensAbi } from "@frontier/sdk/abi";`

## Direct book access

`BookClient` wraps a single book with typed reads (`config`, `position`,
`claimable`, `bidClaimable`, `unfilledPrincipal`) and every maker/taker write,
including the advanced `sweepWithLimits`. Use `MakerAgent`/`TakerAgent` for the
guarded high-level paths.

## Notes & limits

- The deployed `GeometricFrontierBook` is **uniform-only** — there is no shaped
  ladder (`depositShaped`/`requoteShaped`); approximate a slope with a few
  uniform ladders.
- A token pair can have multiple books. Persist the exact `book` address; do not
  rely on `defaultBook` when more than one may exist.
- Quotes go stale — re-quote near execution and keep slippage sane.
- Use normal ERC20s. Rebasing / fee-on-transfer / callback tokens are out of
  scope for the deploy-day path.

## Develop

```sh
pnpm install
pnpm exec tsc --noEmit   # typecheck
pnpm test                # vitest
pnpm build               # emit dist/
```

The workspace is self-rooted (`pnpm-workspace.yaml`) so installs never hoist
into a parent workspace.
