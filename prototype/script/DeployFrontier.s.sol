// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {FrontierGeoBookFactory} from "../src/FrontierGeoBookFactory.sol";
import {GeometricBookDeployer, GeometricOpsDeployer} from "../src/FrontierDeployers.sol";
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
/// - FEE_RECIPIENT: fee recipient, defaults to deployer
/// - MAKER_FEE_BPS: maker claim fee in basis points, defaults to 0
/// - TAKER_FEE_BPS: taker input fee in basis points, defaults to 0
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
        address deployer = vm.addr(pk);
        address feeRecipient = vm.envOr("FEE_RECIPIENT", deployer);
        uint16 makerFeeBps = uint16(vm.envOr("MAKER_FEE_BPS", uint256(0)));
        uint16 takerFeeBps = uint16(vm.envOr("TAKER_FEE_BPS", uint256(0)));

        require(token0 != address(0) && token1 != address(0) && token0 != token1, "bad tokens");
        require(tickSpacing > 0, "bad spacing");
        require(startTick % tickSpacing == 0, "unaligned start");
        require(makerFeeBps <= 1_000 && takerFeeBps <= 1_000, "fee too high");
        require(feeRecipient != address(0) || (makerFeeBps == 0 && takerFeeBps == 0), "fee recipient required");

        vm.startBroadcast(pk);

        PermissionRegistry registry = new PermissionRegistry();
        FrontierGeoBookFactory factory =
            new FrontierGeoBookFactory(address(registry), new GeometricBookDeployer(), new GeometricOpsDeployer());
        FrontierLens lens = new FrontierLens();
        FrontierRouter router = new FrontierRouter(address(factory), lens);
        address book = factory.createGeoBookWithFees(
            token0, token1, tickSpacing, startTick, feeRecipient, makerFeeBps, takerFeeBps
        );

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
            '  "feeRecipient": "', vm.toString(feeRecipient), '",\n',
            '  "makerFeeBps": ', vm.toString(uint256(makerFeeBps)), ',\n',
            '  "takerFeeBps": ', vm.toString(uint256(takerFeeBps)), ',\n',
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
        console2.log("feeRecipient", feeRecipient);
        console2.log("makerFeeBps", makerFeeBps);
        console2.log("takerFeeBps", takerFeeBps);
    }
}
