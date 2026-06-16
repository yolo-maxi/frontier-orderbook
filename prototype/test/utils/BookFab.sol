// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {UniformFrontierBook} from "../../src/UniformFrontierBook.sol";
import {UniformMakerOps} from "../../src/UniformMakerOps.sol";
import {GeometricFrontierBook, GeometricMakerOps} from "../../src/GeometricFrontierBook.sol";
import {FrontierGeoBookFactory} from "../../src/FrontierGeoBookFactory.sol";
import {GeometricBookDeployer, GeometricOpsDeployer} from "../../src/FrontierDeployers.sol";

/// @notice Test-side stand-in for the factory's two-step deploy: every book
/// needs a maker-ops companion with matching immutables (see FrontierBookBase).
/// Free functions so test files can keep one-line book construction.
///
/// `newBook` builds a UNIFORM book on the base (linear demo) curve — the
/// shared FrontierBookBase machinery exercised by the broad correctness/gas
/// suites without the geometric curve's pow arithmetic. The production book
/// (GeometricFrontierBook) extends UniformFrontierBook, so anything typed
/// against UniformFrontierBook also drives a geometric book. Use `newGeoBook`
/// for the production 1.0001^tick curve.
function newBook(address token0, address token1, int24 tickSpacing, int24 startTick, address hooks, address permissions)
    returns (UniformFrontierBook)
{
    return newBookWithFees(token0, token1, tickSpacing, startTick, hooks, permissions, address(0), 0, 0);
}

function newBookWithFees(
    address token0,
    address token1,
    int24 tickSpacing,
    int24 startTick,
    address hooks,
    address permissions,
    address feeRecipient,
    uint16 makerFeeBps,
    uint16 takerFeeBps
) returns (UniformFrontierBook) {
    UniformMakerOps ops = new UniformMakerOps(
        token0, token1, tickSpacing, hooks, permissions, feeRecipient, makerFeeBps, takerFeeBps
    );
    return new UniformFrontierBook(
        token0, token1, tickSpacing, startTick, hooks, permissions, address(ops), feeRecipient, makerFeeBps, takerFeeBps
    );
}

function newGeoBook(
    address token0,
    address token1,
    int24 tickSpacing,
    int24 startTick,
    address hooks,
    address permissions
) returns (GeometricFrontierBook) {
    return newGeoBookWithFees(token0, token1, tickSpacing, startTick, hooks, permissions, address(0), 0, 0);
}

function newGeoBookWithFees(
    address token0,
    address token1,
    int24 tickSpacing,
    int24 startTick,
    address hooks,
    address permissions,
    address feeRecipient,
    uint16 makerFeeBps,
    uint16 takerFeeBps
) returns (GeometricFrontierBook) {
    GeometricMakerOps ops = new GeometricMakerOps(
        token0, token1, tickSpacing, hooks, permissions, feeRecipient, makerFeeBps, takerFeeBps
    );
    return new GeometricFrontierBook(
        token0, token1, tickSpacing, startTick, hooks, permissions, address(ops), feeRecipient, makerFeeBps, takerFeeBps
    );
}

/// @notice The production geometric factory, wired with its deployers. Tests
/// that exercise factory mechanics (memoization, defaultBook, parallel books)
/// use this; the rolling/linear FrontierBookFactory was removed.
function newFactory(address registry) returns (FrontierGeoBookFactory) {
    return new FrontierGeoBookFactory(
        registry,
        new GeometricBookDeployer(),
        new GeometricOpsDeployer()
    );
}
