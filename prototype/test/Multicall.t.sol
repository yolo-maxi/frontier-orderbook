// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test, console2} from "forge-std/Test.sol";
import {MockERC20} from "../src/MockERC20.sol";
import {UniformFrontierBook} from "../src/UniformFrontierBook.sol";
import {newBook} from "./utils/BookFab.sol";

/// @notice Mixed-settlement test: verify claim + cancel + requote compose correctly.
/// (Multicall was removed from the deploy-facing book; operations are separate txs.)
contract MulticallTest is Test {
    MockERC20 internal t0;
    MockERC20 internal t1;
    UniformFrontierBook internal book;

    address internal mm = makeAddr("mm");
    address internal taker = makeAddr("taker");

    uint128 internal constant L = 1e18;

    function setUp() public {
        t0 = new MockERC20("T0", "T0");
        t1 = new MockERC20("T1", "T1");
        book = newBook(address(t0), address(t1), 1, 0, address(0), address(0));
        t0.mint(mm, 1e30);
        t1.mint(taker, 1e30);
        vm.prank(mm);
        t0.approve(address(book), type(uint256).max);
        vm.prank(taker);
        t1.approve(address(book), type(uint256).max);
    }

    function testMixedSettlement() public {
        // claim a filled ask, cancel a live one, requote a third
        vm.startPrank(mm);
        uint256 a = book.deposit(1, 4, L);
        uint256 b = book.deposit(50, 53, L);
        uint256 c = book.deposit(100, 103, L);
        vm.stopPrank();
        vm.prank(taker);
        book.moveTickTo(4);

        uint256 before = t1.balanceOf(mm);
        vm.startPrank(mm);
        book.claim(a);
        book.cancel(b);
        book.requote(c, 200, 203, L);
        vm.stopPrank();

        assertGt(t1.balanceOf(mm) - before, 0, "claim produced proceeds");
        assertEq(book.claimable(a), 0, "claimed");
        assertEq(book.activeLiquidity(50), 0, "cancelled");
        assertEq(book.activeLiquidity(200), L, "requoted to 200");
    }
}
