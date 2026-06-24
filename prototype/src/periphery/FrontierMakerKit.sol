// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.24;

import {UniformFrontierBook} from "../UniformFrontierBook.sol";
import {IERC20Minimal} from "../RangeTakeProfitBook.sol";

/// @title FrontierMakerKit — expressive maker periphery: compose a quoting
/// curve out of uniform ladder segments (each segment is one O(1) position)
/// and place them in a single transaction; batch-settle whole portfolios.
/// Positions are owned by the CALLER (the kit only routes), so all
/// management/claiming stays delegatable via the permission registry.
contract FrontierMakerKit {
    struct Segment {
        int24 lower;
        int24 upper;
        uint128 size; // uniform size at every level of the segment
        bool isBid; // bid or ask
    }

    /// @notice Place a whole quoting curve in one tx. Pulls exact totals from
    /// the caller, deposits each segment in the caller's name via
    /// transferFrom-funded book deposits, returns the position ids.
    function placeCurve(UniformFrontierBook book, Segment[] calldata segments)
        external
        returns (uint256[] memory ids)
    {
        ids = new uint256[](segments.length);
        IERC20Minimal t0 = book.token0();
        IERC20Minimal t1 = book.token1();
        for (uint256 i = 0; i < segments.length; i++) {
            Segment calldata seg = segments[i];
            if (seg.isBid) {
                uint256 cost = _bidCost(book, seg);
                require(t1.transferFrom(msg.sender, address(this), cost), "pull1 failed");
                _approve(address(t1), address(book));
                ids[i] = book.depositBid(seg.lower, seg.upper, seg.size);
            } else {
                uint256 cost = _askCost(book, seg);
                require(t0.transferFrom(msg.sender, address(this), cost), "pull0 failed");
                _approve(address(t0), address(book));
                ids[i] = book.deposit(seg.lower, seg.upper, seg.size);
            }
            // hand the position to the caller — positions are transferable
            book.transferPosition(ids[i], msg.sender);
        }
    }

    function _askCost(UniformFrontierBook book, Segment calldata seg) internal view returns (uint256) {
        uint24 n = uint24(seg.upper - seg.lower) / uint24(book.tickSpacing());
        return uint256(seg.size) * uint256(n);
    }

    function _bidCost(UniformFrontierBook book, Segment calldata seg) internal view returns (uint256 cost) {
        int24 s = book.tickSpacing();
        for (int24 t = seg.lower; t < seg.upper; t += s) {
            cost += (uint256(seg.size) * book.rateAt(t) + 1e18 - 1) / 1e18;
        }
    }

    function _approve(address token, address spender) internal {
        (bool ok,) = token.call(abi.encodeWithSignature("approve(address,uint256)", spender, type(uint256).max));
        require(ok, "approve failed");
    }
}
