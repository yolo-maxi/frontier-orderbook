// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {FrontierGeoBookFactory} from "../src/FrontierGeoBookFactory.sol";
import {GeometricBookDeployer, GeometricOpsDeployer} from "../src/FrontierDeployers.sol";
import {MockERC20} from "../src/MockERC20.sol";
import {UniformFrontierBook} from "../src/UniformFrontierBook.sol";
import {FrontierLens} from "../src/periphery/FrontierLens.sol";
import {FrontierRouter} from "../src/periphery/FrontierRouter.sol";
import {PermissionRegistry} from "../src/permissions/PermissionRegistry.sol";

/// @notice Deploy a Base Sepolia YES/USDC geometric Frontier book for the PM UI.
///
/// Required env:
/// - PRIVATE_KEY: deployer private key
contract DeployFrontierPM is Script {
    string internal constant NAME = unicode"Frontier Testnet — YES/USDC";
    string internal constant RPC_URL = "https://sepolia.base.org";
    string internal constant QUESTION = "Will ETH close above $5,000 in 2026?";
    string internal constant UI_OUT = "../ui/public/deployment.json";
    string internal constant PROTOTYPE_OUT = "deployments/base-sepolia-pm.json";

    uint256 internal constant CHAIN_ID = 84532;
    uint256 internal constant INITIAL_MINT = 1_000_000_000 ether;
    int24 internal constant TICK_SPACING = 60;
    int24 internal constant START_TICK = 0;
    uint16 internal constant MAKER_FEE_BPS = 0;
    uint16 internal constant TAKER_FEE_BPS = 30;

    uint128 internal constant NEAR_LIQUIDITY = 200 ether;
    uint128 internal constant FAR_LIQUIDITY = 50 ether;
    uint256 internal constant INITIAL_MIRROR_0 = 500 ether;
    uint256 internal constant INITIAL_MIRROR_1 = 500 ether;
    uint256 internal constant ZAP_AMOUNT_1 = 1_000 ether;
    uint256 internal constant PREVIEW_CHECK_0 = 10 ether;
    uint256 internal constant PREVIEW_CHECK_1 = 10 ether;

    struct Deployment {
        address deployer;
        MockERC20 yes;
        MockERC20 usdc;
        PermissionRegistry registry;
        FrontierGeoBookFactory factory;
        FrontierLens lens;
        FrontierRouter router;
        UniformFrontierBook book;
    }

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);

        require(block.chainid == CHAIN_ID, "wrong chain");
        require(START_TICK % TICK_SPACING == 0, "unaligned start");

        vm.startBroadcast(pk);

        Deployment memory d;
        d.deployer = deployer;
        d.yes = new MockERC20("Frontier YES", "YES");
        d.usdc = new MockERC20("Test USDC", "USDC");
        d.yes.mint(deployer, INITIAL_MINT);
        d.usdc.mint(deployer, INITIAL_MINT);

        d.registry = new PermissionRegistry();
        d.factory =
            new FrontierGeoBookFactory(address(d.registry), new GeometricBookDeployer(), new GeometricOpsDeployer());
        d.lens = new FrontierLens();
        d.router = new FrontierRouter(address(d.factory), d.lens);

        address bookAddr = d.factory
            .createGeoBookWithFees(
                address(d.yes), address(d.usdc), TICK_SPACING, START_TICK, deployer, MAKER_FEE_BPS, TAKER_FEE_BPS
            );
        d.book = UniformFrontierBook(bookAddr);

        _approveAndSeed(d);
        _assertLive(d);

        vm.stopBroadcast();

        _writeDeployment(d, UI_OUT);
        _writeDeployment(d, PROTOTYPE_OUT);

        console2.log("Frontier PM deployment written to", UI_OUT);
        console2.log("Prototype deployment written to", PROTOTYPE_OUT);
        console2.log("book", address(d.book));
        console2.log("router", address(d.router));
        console2.log("lens", address(d.lens));
        console2.log("factory", address(d.factory));
        console2.log("registry", address(d.registry));
        console2.log("YES", address(d.yes));
        console2.log("USDC", address(d.usdc));
        console2.log("tickSpacing", TICK_SPACING);
        console2.log("startTick", START_TICK);
        console2.log("takerFeeBps", TAKER_FEE_BPS);
    }

    function _approveAndSeed(Deployment memory d) internal {
        d.yes.approve(address(d.book), type(uint256).max);
        d.usdc.approve(address(d.book), type(uint256).max);
        d.yes.approve(address(d.router), type(uint256).max);
        d.usdc.approve(address(d.router), type(uint256).max);

        d.book.deposit(60, 660, NEAR_LIQUIDITY);
        d.book.deposit(660, 1260, FAR_LIQUIDITY);
        d.book.depositBid(-600, 0, NEAR_LIQUIDITY);
        d.book.depositBid(-1200, -600, FAR_LIQUIDITY);

        d.book.depositMirror(INITIAL_MIRROR_0, INITIAL_MIRROR_1, 0);

        FrontierRouter.ZapResult memory preview = d.router.previewZapDepositMirror(d.book, 0, ZAP_AMOUNT_1);
        require(preview.shares > 0, "zap preview shares");
        require(preview.swapOut > 0, "zap preview swap");
        d.router.zapDepositMirror(d.book, 0, ZAP_AMOUNT_1, 1, 1, d.deployer, block.timestamp + 1 hours);
    }

    function _assertLive(Deployment memory d) internal view {
        require(d.book.tickSpacing() == TICK_SPACING, "bad spacing");
        require(d.book.takerFeeBps() == TAKER_FEE_BPS, "bad taker fee");

        (uint256 reserve0, uint256 reserve1, uint256 shares) = d.book.mirrorReserves();
        require(reserve0 > 0 && reserve1 > 0 && shares > 0, "mirror not funded");

        FrontierRouter.ZapResult memory preview =
            d.router.previewZapDepositMirror(d.book, PREVIEW_CHECK_0, PREVIEW_CHECK_1);
        require(preview.shares > 0, "preview check failed");
    }

    function _writeDeployment(Deployment memory d, string memory out) internal {
        vm.writeFile(out, "");
        vm.writeLine(out, "{");
        vm.writeLine(out, string.concat('  "name": "', NAME, '",'));
        vm.writeLine(out, string.concat('  "chainId": ', vm.toString(CHAIN_ID), ","));
        vm.writeLine(out, string.concat('  "rpcUrl": "', RPC_URL, '",'));
        vm.writeLine(out, '  "curve": "geometric",');
        vm.writeLine(out, string.concat('  "tickSpacing": ', vm.toString(int256(TICK_SPACING)), ","));
        vm.writeLine(out, string.concat('  "startTick": ', vm.toString(int256(START_TICK)), ","));
        vm.writeLine(out, string.concat('  "feeRecipient": "', vm.toString(d.deployer), '",'));
        vm.writeLine(out, string.concat('  "makerFeeBps": ', vm.toString(uint256(MAKER_FEE_BPS)), ","));
        vm.writeLine(out, string.concat('  "takerFeeBps": ', vm.toString(uint256(TAKER_FEE_BPS)), ","));
        vm.writeLine(out, '  "contracts": {');
        vm.writeLine(out, string.concat('    "book": "', vm.toString(address(d.book)), '",'));
        vm.writeLine(out, string.concat('    "router": "', vm.toString(address(d.router)), '",'));
        vm.writeLine(out, string.concat('    "lens": "', vm.toString(address(d.lens)), '",'));
        vm.writeLine(out, string.concat('    "factory": "', vm.toString(address(d.factory)), '",'));
        vm.writeLine(out, string.concat('    "registry": "', vm.toString(address(d.registry)), '",'));
        vm.writeLine(out, string.concat('    "lpFactory": "', vm.toString(address(0)), '",'));
        vm.writeLine(out, string.concat('    "yieldVault": "', vm.toString(address(0)), '",'));
        vm.writeLine(out, string.concat('    "weth": "', vm.toString(address(d.yes)), '",'));
        vm.writeLine(out, string.concat('    "usdc": "', vm.toString(address(d.usdc)), '"'));
        vm.writeLine(out, "  },");
        vm.writeLine(out, '  "tokens": {');
        vm.writeLine(out, '    "base": "YES",');
        vm.writeLine(out, '    "quote": "USDC",');
        vm.writeLine(out, string.concat('    "baseAddress": "', vm.toString(address(d.yes)), '",'));
        vm.writeLine(out, string.concat('    "quoteAddress": "', vm.toString(address(d.usdc)), '",'));
        vm.writeLine(out, '    "baseDecimals": 18,');
        vm.writeLine(out, '    "quoteDecimals": 18');
        vm.writeLine(out, "  },");
        vm.writeLine(out, '  "darkbox": {');
        vm.writeLine(out, '    "network": "base-sepolia",');
        vm.writeLine(out, string.concat('    "syntheticUSDC": "', vm.toString(address(d.usdc)), '",'));
        vm.writeLine(out, '    "selectedSide": "yes",');
        vm.writeLine(out, '    "category": "Crypto - Price",');
        vm.writeLine(out, '    "market": {');
        vm.writeLine(out, string.concat('      "question": "', QUESTION, '",'));
        vm.writeLine(out, string.concat('      "yesToken": "', vm.toString(address(d.yes)), '",'));
        vm.writeLine(out, string.concat('      "yesBook": "', vm.toString(address(d.book)), '"'));
        vm.writeLine(out, "    }");
        vm.writeLine(out, "  }");
        vm.writeLine(out, "}");
    }
}
