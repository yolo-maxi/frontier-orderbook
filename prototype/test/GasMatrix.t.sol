// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {MockERC20} from "../src/MockERC20.sol";
import {RollingFrontierBook} from "../src/RollingFrontierBook.sol";

/// @notice Fills the measurement gaps for the comprehensive gas comparison:
/// bid-side operation costs and taker cost-per-level across paths.
contract GasMatrixTest is Test {
    MockERC20 internal t0;
    MockERC20 internal t1;
    RollingFrontierBook internal book;

    address internal mm;
    address internal taker;

    uint128 internal constant L = 1e18;

    function _fresh(int24 startTick) internal {
        t0 = new MockERC20("T0", "T0");
        t1 = new MockERC20("T1", "T1");
        book = new RollingFrontierBook(address(t0), address(t1), 1, startTick);
        mm = makeAddr("mm");
        taker = makeAddr("taker");
        t0.mint(mm, 1e30);
        t1.mint(mm, 1e30);
        vm.startPrank(mm);
        t0.approve(address(book), type(uint256).max);
        t1.approve(address(book), type(uint256).max);
        vm.stopPrank();
        t0.mint(taker, 1e30);
        t1.mint(taker, 1e30);
        vm.startPrank(taker);
        t0.approve(address(book), type(uint256).max);
        t1.approve(address(book), type(uint256).max);
        vm.stopPrank();
    }

    function testBidOperationCosts() public {
        _fresh(100);
        vm.prank(mm);
        uint256 g = gasleft();
        uint256 id = book.depositBid(50, 60, L);
        console2.log("bid deposit (10 levels):", g - gasleft());

        // wide bid: width independence check (fresh book priced high)
        _fresh(200000);
        vm.prank(mm);
        g = gasleft();
        book.depositBid(50000, 60000, L);
        console2.log("bid deposit (10,000 levels):", g - gasleft());

        _fresh(100);
        vm.prank(mm);
        id = book.depositBid(50, 60, L);

        vm.prank(taker);
        book.moveTickTo(55); // fill 5 levels of the first bid

        vm.prank(mm);
        g = gasleft();
        book.claimBidTo(id, 55);
        console2.log("bid witness-claim:", g - gasleft());

        vm.prank(mm);
        g = gasleft();
        book.cancelBidWithWitness(id, 55);
        console2.log("bid witness-cancel:", g - gasleft());
    }

    function testTakerCostPerLevel() public {
        // 20 flat ask levels
        _fresh(0);
        vm.prank(mm);
        book.deposit(1, 21, L);
        vm.prank(taker);
        uint256 g = gasleft();
        book.moveTickTo(21);
        uint256 flat20 = g - gasleft();
        console2.log("up-sweep 20 flat ask levels:", flat20, "per level:", flat20 / 20);

        // 20 shaped ask levels
        _fresh(0);
        vm.prank(mm);
        book.depositShaped(1, 21, 20 * L, -int128(L));
        vm.prank(taker);
        g = gasleft();
        book.moveTickTo(21);
        uint256 shaped20 = g - gasleft();
        console2.log("up-sweep 20 shaped ask levels:", shaped20, "per level:", shaped20 / 20);

        // 20 bid levels
        _fresh(100);
        vm.prank(mm);
        book.depositBid(50, 70, L);
        vm.prank(taker);
        g = gasleft();
        book.moveTickTo(50);
        uint256 bid20 = g - gasleft();
        console2.log("down-sweep 20 bid levels:", bid20, "per level:", bid20 / 20);
    }

    function testClaimAndCancelScanVsWitness() public {
        _fresh(0);
        vm.prank(mm);
        uint256 id = book.deposit(1, 1001, L); // 1000 levels
        vm.prank(taker);
        book.moveTickTo(3); // 2 fills

        // O(log width) scan path (no witness)
        vm.prank(mm);
        uint256 g = gasleft();
        book.claim(id);
        console2.log("claim via binary-search scan, width 1000:", g - gasleft());

        vm.prank(taker);
        book.moveTickTo(5); // 2 more fills
        vm.prank(mm);
        g = gasleft();
        book.claimTo(id, 5);
        console2.log("claim via witness:", g - gasleft());

        vm.prank(mm);
        g = gasleft();
        book.cancel(id);
        console2.log("cancel via binary-search scan, width 1000:", g - gasleft());
    }
}
