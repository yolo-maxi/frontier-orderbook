// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {FrontierBookFactory} from "../src/FrontierBookFactory.sol";
import {
    RollingBookDeployer,
    MakerOpsDeployer,
    GeometricBookDeployer,
    GeometricOpsDeployer
} from "../src/FrontierDeployers.sol";
import {FrontierLens} from "../src/periphery/FrontierLens.sol";
import {FrontierRouter} from "../src/periphery/FrontierRouter.sol";
import {PermissionRegistry} from "../src/permissions/PermissionRegistry.sol";

/// @notice Real-token Frontier deployment script.
///
/// Required env:
/// - DEPLOYER_KEY: private key used by forge script --broadcast
/// - TOKEN0: base asset address
/// - TOKEN1: quote asset address
/// - TICK_SPACING: int24 tick spacing
/// - START_TICK: int24 initial book tick
///
/// Optional env:
/// - DEPLOY_NAME: label written to JSON, defaults to "Frontier"
/// - DEPLOY_OUT: output JSON path, defaults to deployments/frontier-latest.json
///
/// Example:
/// forge script script/DeployFrontier.s.sol:DeployFrontier \
///   --rpc-url $RPC_URL --broadcast --verify
contract DeployFrontier is Script {
    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_KEY");
        address token0 = vm.envAddress("TOKEN0");
        address token1 = vm.envAddress("TOKEN1");
        int24 tickSpacing = int24(vm.envInt("TICK_SPACING"));
        int24 startTick = int24(vm.envInt("START_TICK"));
        string memory name = vm.envOr("DEPLOY_NAME", string("Frontier"));
        string memory out = vm.envOr("DEPLOY_OUT", string("deployments/frontier-latest.json"));

        require(token0 != address(0) && token1 != address(0) && token0 != token1, "bad tokens");
        require(tickSpacing > 0, "bad spacing");
        require(startTick % tickSpacing == 0, "unaligned start");

        vm.startBroadcast(pk);

        PermissionRegistry registry = new PermissionRegistry();
        FrontierBookFactory factory = new FrontierBookFactory(
            address(registry),
            new RollingBookDeployer(),
            new MakerOpsDeployer(),
            new GeometricBookDeployer(),
            new GeometricOpsDeployer()
        );
        FrontierLens lens = new FrontierLens();
        FrontierRouter router = new FrontierRouter(factory, lens);
        address book = factory.createGeoBook(token0, token1, tickSpacing, startTick);

        vm.stopBroadcast();

        string memory json = string.concat(
            '{\n',
            '  "name": "', name, '",\n',
            '  "chainId": ', vm.toString(block.chainid), ',\n',
            '  "curve": "geometric",\n',
            '  "token0": "', vm.toString(token0), '",\n',
            '  "token1": "', vm.toString(token1), '",\n',
            '  "tickSpacing": ', vm.toString(int256(tickSpacing)), ',\n',
            '  "startTick": ', vm.toString(int256(startTick)), ',\n',
            '  "contracts": {\n',
            '    "book": "', vm.toString(book), '",\n',
            '    "factory": "', vm.toString(address(factory)), '",\n',
            '    "router": "', vm.toString(address(router)), '",\n',
            '    "lens": "', vm.toString(address(lens)), '",\n',
            '    "registry": "', vm.toString(address(registry)), '"\n',
            '  }\n',
            '}\n'
        );
        vm.writeFile(out, json);

        console2.log("Frontier deployment written to", out);
        console2.log("book", book);
        console2.log("factory", address(factory));
        console2.log("router", address(router));
        console2.log("lens", address(lens));
        console2.log("registry", address(registry));
    }
}
