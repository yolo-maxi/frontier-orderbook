// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MockERC20} from "../src/MockERC20.sol";
import {IRangeOrderBook} from "../src/IRangeOrderBook.sol";

/// @notice Shared harness. The test contract itself plays the "market": it
/// holds token1, approves the book, and triggers fills via moveTickTo.
abstract contract BookTestBase is Test {
    MockERC20 internal t0;
    MockERC20 internal t1;
    IRangeOrderBook internal book;
    int24 internal spacing;

    address internal bob;
    address internal carol;
    address internal eve;
    address internal dan;

    uint128 internal constant L = 1e18;
    uint256 internal constant FUND = 1e30;

    function _newBook(address token0, address token1_, int24 spacing_, int24 startTick)
        internal
        virtual
        returns (IRangeOrderBook);

    function setUp() public virtual {
        bob = makeAddr("bob");
        carol = makeAddr("carol");
        eve = makeAddr("eve");
        dan = makeAddr("dan");
        _makeBook(1, 0);
    }

    function _makeBook(int24 spacing_, int24 startTick) internal {
        t0 = new MockERC20("Token0", "T0");
        t1 = new MockERC20("Token1", "T1");
        // Uniswap pools require currency0 < currency1 by address; harmless
        // for the standalone books, mandatory for the hook.
        if (address(t0) > address(t1)) (t0, t1) = (t1, t0);
        spacing = spacing_;
        book = _newBook(address(t0), address(t1), spacing_, startTick);

        address[4] memory users = [bob, carol, eve, dan];
        for (uint256 i = 0; i < users.length; i++) {
            t0.mint(users[i], FUND);
            vm.prank(users[i]);
            t0.approve(address(book), type(uint256).max);
        }
        // the market pays token1 on up-moves and token0 on down-moves
        t0.mint(address(this), FUND);
        t1.mint(address(this), FUND);
        t0.approve(address(book), type(uint256).max);
        t1.approve(address(book), type(uint256).max);
    }

    function dep(address user, int24 lower, int24 upper, uint128 liquidity) internal returns (uint256 id) {
        vm.prank(user);
        id = book.deposit(lower, upper, liquidity);
    }

    function claimAs(address user, uint256 id) internal returns (uint256) {
        vm.prank(user);
        return book.claim(id);
    }

    function cancelAs(address user, uint256 id) internal returns (uint256, uint256) {
        vm.prank(user);
        return book.cancel(id);
    }

    /// @dev Expected token1 proceeds for one filled interval. Default mirrors
    /// the standalone books' linear curve; the hook suite overrides with real
    /// sqrt-price math.
    function amt1(int24 lowerTick, uint256 liquidity) internal view virtual returns (uint256) {
        return (liquidity * uint256(int256(1e18) + int256(lowerTick) * 1e15)) / 1e18;
    }

    /// @dev Expected token0 principal per interval per liquidity unit.
    function amt0(int24 lowerTick, uint256 liquidity) internal view virtual returns (uint256) {
        lowerTick; // silence unused warning in default impl
        return liquidity;
    }

    /// @dev Expected total token0 principal over intervals [lo, hi).
    function sumAmt0(int24 lo, int24 hi, uint256 liquidity) internal view returns (uint256 total) {
        for (int24 t = lo; t < hi; t += spacing) {
            total += amt0(t, liquidity);
        }
    }
}
