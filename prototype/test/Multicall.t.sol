// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test, console2} from "forge-std/Test.sol";
import {MockERC20} from "../src/MockERC20.sol";
import {RollingFrontierBook} from "../src/RollingFrontierBook.sol";
import {newBook} from "./utils/BookFab.sol";

/// @notice Book-level multicall: batch-settle a maker portfolio in one
/// transaction with authorization identical to separate calls.
contract MulticallTest is Test {
    MockERC20 internal t0;
    MockERC20 internal t1;
    RollingFrontierBook internal book;

    address internal mm = makeAddr("mm");
    address internal rando = makeAddr("rando");
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

    function _threeFilledAsks() internal returns (uint256[3] memory ids) {
        vm.startPrank(mm);
        ids[0] = book.deposit(1, 4, L);
        ids[1] = book.deposit(5, 8, L);
        ids[2] = book.deposit(9, 12, L);
        vm.stopPrank();
        vm.prank(taker);
        book.moveTickTo(12); // fill everything
    }

    function testBatchClaimsMatchIndividual() public {
        uint256[3] memory ids = _threeFilledAsks();
        uint256 expected = book.claimable(ids[0]) + book.claimable(ids[1]) + book.claimable(ids[2]);
        assertGt(expected, 0, "fills exist");

        bytes[] memory calls = new bytes[](3);
        for (uint256 i = 0; i < 3; i++) {
            calls[i] = abi.encodeCall(book.claim, (ids[i]));
        }
        uint256 before = t1.balanceOf(mm);
        vm.prank(mm);
        uint256 g = gasleft();
        bytes[] memory results = book.multicall(calls);
        uint256 batched = g - gasleft();
        assertEq(t1.balanceOf(mm) - before, expected, "batched payout == sum of claims");
        uint256 sum;
        for (uint256 i = 0; i < 3; i++) {
            sum += abi.decode(results[i], (uint256));
        }
        assertEq(sum, expected, "per-call results returned");
        console2.log("multicall 3 claims, one tx:", batched);
        console2.log("(separate claims pay one 21k intrinsic + cold book/token access each)");
    }

    function testAuthorizationPreserved() public {
        uint256[3] memory ids = _threeFilledAsks();
        bytes[] memory calls = new bytes[](1);
        calls[0] = abi.encodeCall(book.claim, (ids[0]));
        vm.prank(rando);
        vm.expectRevert(); // not the owner, no registry grant
        book.multicall(calls);
    }

    function testInnerRevertBubblesAndAborts() public {
        uint256[3] memory ids = _threeFilledAsks();
        bytes[] memory calls = new bytes[](2);
        calls[0] = abi.encodeCall(book.claim, (ids[0]));
        calls[1] = abi.encodeCall(book.claim, (uint256(999))); // nonexistent
        uint256 before = t1.balanceOf(mm);
        vm.prank(mm);
        vm.expectRevert();
        book.multicall(calls);
        assertEq(t1.balanceOf(mm), before, "atomic: nothing paid out");
    }

    function testMixedSettlementBatch() public {
        // claim a filled ask, cancel a live one, requote a third — one tx
        vm.startPrank(mm);
        uint256 a = book.deposit(1, 4, L);
        uint256 b = book.deposit(50, 53, L);
        uint256 c = book.deposit(100, 103, L);
        vm.stopPrank();
        vm.prank(taker);
        book.moveTickTo(4);

        bytes[] memory calls = new bytes[](3);
        calls[0] = abi.encodeCall(book.claim, (a));
        calls[1] = abi.encodeCall(book.cancel, (b));
        calls[2] = abi.encodeCall(book.requote, (c, 200, 203, L));

        vm.prank(mm);
        book.multicall(calls);

        assertEq(book.claimable(a), 0, "claimed");
        assertEq(book.activeLiquidity(50), 0, "cancelled");
        assertEq(book.activeLiquidity(200), L, "requoted to 200");
    }
}
