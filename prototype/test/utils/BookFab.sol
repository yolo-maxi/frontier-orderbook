// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {RollingFrontierBook} from "../../src/RollingFrontierBook.sol";
import {FrontierMakerOps} from "../../src/FrontierMakerOps.sol";
import {GeometricFrontierBook, GeometricMakerOps} from "../../src/GeometricFrontierBook.sol";
import {FrontierBookFactory} from "../../src/FrontierBookFactory.sol";
import {
    RollingBookDeployer,
    MakerOpsDeployer,
    GeometricBookDeployer,
    GeometricOpsDeployer
} from "../../src/FrontierDeployers.sol";

/// @notice Test-side stand-in for the factory's two-step deploy: every book
/// needs a FrontierMakerOps companion with matching immutables (see
/// FrontierBookBase). Free functions so test files can keep one-line book
/// construction.
function newBook(address token0, address token1, int24 tickSpacing, int24 startTick, address hooks, address permissions)
    returns (RollingFrontierBook)
{
    FrontierMakerOps ops = new FrontierMakerOps(token0, token1, tickSpacing, hooks, permissions);
    return new RollingFrontierBook(token0, token1, tickSpacing, startTick, hooks, permissions, address(ops));
}

function newGeoBook(
    address token0,
    address token1,
    int24 tickSpacing,
    int24 startTick,
    address hooks,
    address permissions
) returns (GeometricFrontierBook) {
    GeometricMakerOps ops = new GeometricMakerOps(token0, token1, tickSpacing, hooks, permissions);
    return new GeometricFrontierBook(token0, token1, tickSpacing, startTick, hooks, permissions, address(ops));
}

function newFactory(address registry) returns (FrontierBookFactory) {
    return new FrontierBookFactory(
        registry, new RollingBookDeployer(), new MakerOpsDeployer(), new GeometricBookDeployer(), new GeometricOpsDeployer()
    );
}
