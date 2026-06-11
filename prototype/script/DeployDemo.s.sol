// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {MockERC20} from "../src/MockERC20.sol";
import {MockYieldVault} from "../src/MockYieldVault.sol";
import {RollingFrontierBook} from "../src/RollingFrontierBook.sol";
import {FrontierBookFactory} from "../src/FrontierBookFactory.sol";
import {
    RollingBookDeployer,
    MakerOpsDeployer,
    GeometricBookDeployer,
    GeometricOpsDeployer
} from "../src/FrontierDeployers.sol";
import {FrontierRouter} from "../src/periphery/FrontierRouter.sol";
import {FrontierLens} from "../src/periphery/FrontierLens.sol";
import {RangeLPFactory} from "../src/periphery/RangeLP.sol";
import {PermissionRegistry} from "../src/permissions/PermissionRegistry.sol";

/// @notice Full demo-stack deployment: tokens, registry, factory, periphery,
/// the ETH/USDC book seeded two-sided around $4,000, LP factory, yield vault.
/// Works on the clob devnet and (unchanged) on Base Sepolia once a funded
/// key exists.
contract DeployDemo is Script {
    // price model: rate = 1 + 0.001*tick USDC per WETH => $4,000 = tick 3,999,000
    int24 constant START_TICK = 3_999_000;
    uint128 constant SEED_SIZE = 1e15; // 0.001 WETH per level

    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_KEY");
        address deployer = vm.addr(pk);
        vm.startBroadcast(pk);

        MockERC20 weth = new MockERC20("Wrapped Ether (demo)", "WETH");
        MockERC20 usdc = new MockERC20("USD Coin (demo)", "USDC");
        PermissionRegistry registry = new PermissionRegistry();
        FrontierBookFactory factory = new FrontierBookFactory(
            address(registry),
            new RollingBookDeployer(),
            new MakerOpsDeployer(),
            new GeometricBookDeployer(),
            new GeometricOpsDeployer()
        );
        FrontierRouter router = new FrontierRouter(factory);
        FrontierLens lens = new FrontierLens();
        RangeLPFactory lpFactory = new RangeLPFactory();
        MockYieldVault yieldVault = new MockYieldVault(address(weth), "Yield-bearing demo WETH", "ywWETH");

        RollingFrontierBook book =
            RollingFrontierBook(factory.createBook(address(weth), address(usdc), 1, START_TICK));

        // seed a two-sided market around $4,000: 2,000 thin levels per side
        weth.mint(deployer, 1_000_000e18);
        usdc.mint(deployer, 1_000_000_000e18);
        weth.approve(address(book), type(uint256).max);
        usdc.approve(address(book), type(uint256).max);
        book.deposit(START_TICK + 1_000, START_TICK + 3_000, SEED_SIZE); // asks ~$4000.001-$4003
        book.depositBid(START_TICK - 3_000, START_TICK - 1_000, SEED_SIZE); // bids ~$3997-$3999.999

        vm.stopBroadcast();

        string memory json = string.concat(
            '{\n  "name": "Frontier Devnet",\n  "chainId": ',
            vm.toString(block.chainid),
            ',\n  "startTick": ',
            vm.toString(int256(START_TICK)),
            ',\n  "contracts": {\n    "book": "',
            vm.toString(address(book)),
            '",\n    "factory": "',
            vm.toString(address(factory)),
            '",\n    "router": "',
            vm.toString(address(router)),
            '",\n    "lens": "',
            vm.toString(address(lens)),
            '",\n    "registry": "',
            vm.toString(address(registry)),
            '",\n    "lpFactory": "',
            vm.toString(address(lpFactory)),
            '",\n    "yieldVault": "',
            vm.toString(address(yieldVault)),
            '",\n    "weth": "',
            vm.toString(address(weth)),
            '",\n    "usdc": "',
            vm.toString(address(usdc)),
            '"\n  }\n}\n'
        );
        vm.writeFile("deployments/latest.json", json);
        console2.log("deployment written to deployments/latest.json");
    }
}
