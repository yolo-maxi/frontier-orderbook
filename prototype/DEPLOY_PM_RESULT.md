# Frontier PM Base Sepolia Deployment

Date: 2026-06-25
Chain: Base Sepolia, chainId `84532`
RPC: `https://sepolia.base.org`
Deployer: `0xF053A15C36f1FbCC2A281095e6f1507ea1EFc931`
Broadcast block: `43290174`

## Addresses

- YES (`Frontier YES`, 18 decimals): `0xFbD9Aa1C191B60AFD25e01F664D4E3DfDAdDE9C3`
- USDC (`Test USDC`, 18 decimals): `0xfc55fcD005c1A157Bd3F4b198b3c049F5A3c7684`
- PermissionRegistry: `0xeaFb781e2abB00F6efF675dA5089dEbd1eB70dfb`
- GeometricBookDeployer: `0xb46768402f135368344D76Cf4f1aD539a889746b`
- GeometricOpsDeployer: `0x08885e54a3E144afd3F5c49347609387dEdfE81a`
- FrontierGeoBookFactory: `0x99E28e0913EF0FB01E3f88036f2353bDB387977f`
- FrontierLens: `0xea6EE23d11C2496Cd2BcB283b62fc4A7a20BE36B`
- FrontierRouter: `0x386ECD432e8B08563B5802DEc38ef55Ab670fbC1`
- Geometric YES/USDC book: `0xe61Bfd5e53c30DdB9175f69Dd20c69545C468E92`

## Tick And Fee Params

- `tickSpacing`: `60`
- `startTick`: `0`
- `makerFeeBps`: `0`
- `takerFeeBps`: `30`

The previous devnet `startTick` (`1627605`) is outside `GeoTickMath.MAX_TICK == 200000`, so this deployment uses `startTick = 0` with `tickSpacing = 60`. That gives a centered probability-style book around `P(0) = 1`, keeps all seeded levels in the geometric domain, and aligns every maker range with the spacing.

## Transaction Hashes

- Deploy YES: `0xd42557ba73bc40e9ce865f3ec03680b82e13612399962ece3b90025e487b75b9`
- Deploy USDC: `0xa84004e8d66871d8ea6001be03a620b4feebfd31ed642ad49b8376e81d089e97`
- Deploy PermissionRegistry: `0x4b6db4c0cb4772e4ed586b4fc641f7eabd372384b6bc53821ef168d99228a041`
- Deploy GeometricBookDeployer: `0x493434b2152311e7870cf8ff314a28f82c213a439a666640451cac1bd40bef82`
- Deploy GeometricOpsDeployer: `0x1fa558241e81e66904aa9111b6938a5c9d68cddc0c45443550741c30056101c7`
- Deploy FrontierGeoBookFactory: `0x77d8260bf91dda7775d93c0355f8edf6fde5b566d3de8e4437f84af8da9f748e`
- Deploy FrontierLens: `0x4d90be0c26ad799377de29cd883578e1b70a3bb72b0933f5039f6ba3d8106817`
- Deploy FrontierRouter: `0x73417edb189f152470e1a9f5d88461e4575375f00631436ff24a4cd3f2c5babc`
- `createGeoBookWithFees`: `0xa8fdfad249497328ad49e825d510ca94c83eaa1c730ec0653f6204c2bb67de47`
- Maker ask `[60, 660)`: `0x774ac7c0e208c0723f669fda3a8d0f3612f52d408e9e994a017abc07c943a4e4`
- Maker ask `[660, 1260)`: `0x2d487c538659df4616af0176dee740c165e704a0a87a33390c403f7b73ea3e9d`
- Maker bid `[-600, 0)`: `0xf8cb8c1f542f12382ae8c01b997b661f0dce34293d33bcb793bb713a2d703d6b`
- Maker bid `[-1200, -600)`: `0x1aff358738ec7aa6003c9ed5c66ee879917837a66eb3f7ca2c59dbc7460e797f`
- Initial `depositMirror`: `0x34bc3fd3501ad5535a5da81a741beb16f821403f43f670b260b5fc6b0b99d981`
- `zapDepositMirror`: `0x10fd927c9d0a6a21efebc51ed8365034a66cd88dc640efe93cfe63a95a551e5c`

## Verification

Build and dry-run:

```text
forge build
Compiler run successful.

forge script script/DeployFrontierPM.s.sol:DeployFrontierPM --rpc-url https://sepolia.base.org -vv
SIMULATION COMPLETE.

forge script script/DeployFrontierPM.s.sol:DeployFrontierPM --rpc-url https://sepolia.base.org --broadcast -vv
ONCHAIN EXECUTION COMPLETE & SUCCESSFUL.
```

Cast checks:

```text
cast call $BOOK 'tickSpacing()(int24)'
60

cast call $BOOK 'takerFeeBps()(uint16)'
30

cast call $BOOK 'mirrorReserves()(uint256,uint256,uint256)'
555374995422435246564
1296985621224552409692
1851249984741450821882

cast call $ROUTER 'previewZapDepositMirror(address,uint256,uint256)((uint256,uint256,bool,uint256,uint256,uint256,uint256,uint256,uint256,uint256))' $BOOK 10000000000000000000 10000000000000000000
(10000000000000000000, 10000000000000000000, false, 0, 0, 4282044352180839704, 9999999999999999999, 14273481173936132347, 5717955647819160296, 1)

cast call $ROUTER 'previewZapDepositMirror(address,uint256,uint256)((uint256,uint256,bool,uint256,uint256,uint256,uint256,uint256,uint256,uint256))' $BOOK 0 1000000000000000000000
(0, 1000000000000000000000, false, 406043158683342945245, 400000000000000000000, 140831622488674095952, 593956841316657054754, 733632197936041009671, 259168377511325904048, 1)
```

UI build:

```text
cd ui && CI=true npx vite build
✓ built in 2.28s
```

## Issues

- The initial plan to seed bids through `FrontierMakerKit.placeCurve` failed in dry-run because the kit's bid-cost helper underfunded a geometric bid by a rounding delta. The final script seeds maker liquidity directly through `book.deposit` and `book.depositBid`, which lets the book pull exact geometric amounts.
- A one-sided zap seed of `100e18` USDC was too small after the router split the budget between real and mirror liquidity. The final script uses `1000e18` USDC and verifies preview output before calling `zapDepositMirror`.
- Exact preview shares were too strict as `minSharesOut` for the fee-bearing zap path, so the final script uses positive guards (`minSwapOut = 1`, `minSharesOut = 1`) and verifies mirror reserves and preview liveness after execution.

Deployment JSON was written to:

- `ui/public/deployment.json`
- `prototype/deployments/base-sepolia-pm.json`
