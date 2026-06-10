// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {RollingFrontierBook} from "./RollingFrontierBook.sol";
import {FrontierMakerOps} from "./FrontierMakerOps.sol";

/// @notice EIP-170 plumbing for the factory: a contract that does `new X()`
/// embeds X's full creation code in its own runtime, so a factory deploying
/// the ~23KB book AND its ~20KB maker-ops companion directly would bust the
/// code-size limit itself. Each deployer below embeds exactly ONE initcode
/// and stays under the limit; the factory holds only their addresses.
/// Both are permissionless and stateless — deploying contracts for someone
/// else grants no power over them.
contract RollingBookDeployer {
    function deploy(
        address token0,
        address token1,
        int24 tickSpacing,
        int24 startTick,
        address hooks,
        address permissions,
        address makerOps
    ) external returns (address) {
        return address(new RollingFrontierBook(token0, token1, tickSpacing, startTick, hooks, permissions, makerOps));
    }
}

contract MakerOpsDeployer {
    function deploy(address token0, address token1, int24 tickSpacing, address hooks, address permissions)
        external
        returns (address)
    {
        return address(new FrontierMakerOps(token0, token1, tickSpacing, hooks, permissions));
    }
}
