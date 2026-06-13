// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {RollingFrontierBook} from "./RollingFrontierBook.sol";

/// @notice Prototype vault-backed Frontier book.
///
/// The runtime is the existing rolling book with `frontierVault` set during
/// construction. Its maker-ops companion can be the same FrontierMakerOps code
/// because delegatecall reads the book's storage, including `frontierVault`.
contract SingletonFrontierBook is RollingFrontierBook {
    constructor(
        address _token0,
        address _token1,
        int24 _tickSpacing,
        int24 _initialTick,
        address _hooks,
        address _permissions,
        address _makerOps,
        address _frontierVault
    ) RollingFrontierBook(_token0, _token1, _tickSpacing, _initialTick, _hooks, _permissions, _makerOps) {
        _enableFrontierVault(_frontierVault);
    }
}
