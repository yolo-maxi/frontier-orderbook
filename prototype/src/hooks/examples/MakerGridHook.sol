// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IFrontierHooks} from "../IFrontierHooks.sol";

/// @notice Placement-policy hook: makers may only place order boundaries on
/// a COARSE grid (`makerSpacing`, a multiple of the book's fine tickSpacing),
/// while takers keep full fine-tick resolution — sweeps can park anywhere,
/// so a partially consumed coarse interval is just a survivor frontier delta
/// resting at a fine tick. Deploy at an address with BEFORE_DEPOSIT_FLAG set.
///
/// This is the whole "sub-tick partial fill" mechanism: fill granularity is
/// the book's (fine) tickSpacing and placement granularity is policy, not
/// machinery — see NOTES-partial-fills.md ("coarse maker grid" section).
contract MakerGridHook is IFrontierHooks {
    int24 public immutable makerSpacing;

    constructor(int24 _makerSpacing) {
        require(_makerSpacing > 0, "bad maker spacing");
        makerSpacing = _makerSpacing;
    }

    function beforeDeposit(address, int24 lower, int24 upper, uint128, int128, bool) external view returns (bytes4) {
        require(lower % makerSpacing == 0 && upper % makerSpacing == 0, "off maker grid");
        return IFrontierHooks.beforeDeposit.selector;
    }

    function afterDeposit(address, uint256, bool) external pure returns (bytes4) {
        return IFrontierHooks.afterDeposit.selector;
    }

    function beforeSweep(address, int24, int24) external pure returns (bytes4) {
        return IFrontierHooks.beforeSweep.selector;
    }

    function afterSweep(address, int24, int24, uint256, uint256) external pure returns (bytes4) {
        return IFrontierHooks.afterSweep.selector;
    }

    function afterClaim(address, uint256, uint256) external pure returns (bytes4) {
        return IFrontierHooks.afterClaim.selector;
    }

    function afterCancel(address, uint256, uint256, uint256) external pure returns (bytes4) {
        return IFrontierHooks.afterCancel.selector;
    }
}
