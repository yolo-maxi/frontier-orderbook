// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {MockERC20} from "../src/MockERC20.sol";
import {RollingFrontierBook} from "../src/RollingFrontierBook.sol";
import {newBook} from "./utils/BookFab.sol";

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
        book = newBook(address(t0), address(t1), 1, startTick, address(0), address(0));
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

    function rate(int24 tick) internal pure returns (uint256) {
        return uint256(int256(1e18) + int256(tick) * 1e15);
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

        // claim measured below MUST move real token0 (ERC20 transfer included)
        uint256 mm0Before = t0.balanceOf(mm);
        vm.prank(mm);
        g = gasleft();
        uint256 claimed0 = book.claimBidTo(id, 55);
        console2.log("bid witness-claim (5 filled levels, ERC20 transfer):", g - gasleft());
        assertEq(claimed0, 5 * uint256(L), "claim measured a real 5-level payout");
        assertEq(t0.balanceOf(mm) - mm0Before, 5 * uint256(L), "token0 actually transferred");

        // cancel measured below pays no proceeds (just claimed) but MUST
        // refund real token1 for the 5 unfilled levels
        uint256 mm1Before = t1.balanceOf(mm);
        vm.prank(mm);
        g = gasleft();
        (uint256 proceeds0, uint256 refund1) = book.cancelBidWithWitness(id, 55);
        console2.log("bid witness-cancel (refund transfer, no proceeds):", g - gasleft());
        assertEq(proceeds0, 0, "proceeds already claimed");
        assertGt(refund1, 0, "cancel measured a real refund");
        assertEq(t1.balanceOf(mm) - mm1Before, refund1, "token1 actually transferred");
    }

    function testCreditFundedBidDepositCost() public {
        _fresh(100);

        vm.prank(mm);
        uint256 ask = book.deposit(101, 111, L);
        vm.prank(taker);
        book.moveTickTo(111);
        vm.prank(mm);
        uint256 credited1 = book.claimInternal(ask);

        uint256 bidCost = 0;
        for (int24 tick = 101; tick < 111; tick++) {
            bidCost += (uint256(L) * rate(tick) + 1e18 - 1) / 1e18;
        }
        assertEq(credited1, bidCost, "claim should exactly fund the bid");

        vm.prank(mm);
        t1.approve(address(book), 0);
        uint256 wallet1Before = t1.balanceOf(mm);

        vm.prank(mm);
        uint256 g = gasleft();
        book.depositBid(101, 111, L);
        console2.log("bid deposit from internal credit (10 levels):", g - gasleft());

        assertEq(t1.balanceOf(mm), wallet1Before, "credit-funded bid skipped token1 transferFrom");
        assertEq(book.internalBalance1(mm), 0, "spent internal credit first");
    }

    function testTakerCostPerLevel() public {
        // 20 flat ask levels — assert real input/output so the measurement
        // provably covers fills + both token transfers
        _fresh(0);
        vm.prank(mm);
        book.deposit(1, 21, L);
        vm.prank(taker);
        uint256 g = gasleft();
        (, uint256 paid1, uint256 got0) =
            book.sweepWithLimits(21, type(uint256).max, type(uint256).max, 0, block.timestamp);
        uint256 flat20 = g - gasleft();
        console2.log("up-sweep 20 flat ask levels:", flat20, "per level:", flat20 / 20);
        assertEq(got0, 20 * uint256(L), "swept all 20 levels");
        assertGt(paid1, 0, "real token1 paid");

        // 20 shaped ask levels
        _fresh(0);
        vm.prank(mm);
        book.depositShaped(1, 21, 20 * L, -int128(L));
        vm.prank(taker);
        g = gasleft();
        (, paid1, got0) = book.sweepWithLimits(21, type(uint256).max, type(uint256).max, 0, block.timestamp);
        uint256 shaped20 = g - gasleft();
        console2.log("up-sweep 20 shaped ask levels:", shaped20, "per level:", shaped20 / 20);
        assertEq(got0, 210 * uint256(L), "swept the whole 20+19+..+1 ladder");

        // 20 bid levels
        _fresh(100);
        vm.prank(mm);
        book.depositBid(50, 70, L);
        vm.prank(taker);
        g = gasleft();
        (, uint256 paid0, uint256 got1) =
            book.sweepWithLimits(50, type(uint256).max, type(uint256).max, 0, block.timestamp);
        uint256 bid20 = g - gasleft();
        console2.log("down-sweep 20 bid levels:", bid20, "per level:", bid20 / 20);
        assertEq(paid0, 20 * uint256(L), "sold into all 20 levels");
        assertGt(got1, 0, "real token1 received");
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
        uint256 got = book.claim(id);
        console2.log("claim via binary-search scan, width 1000 (2 fills):", g - gasleft());
        assertGt(got, 0, "scan claim paid real proceeds");

        vm.prank(taker);
        book.moveTickTo(5); // 2 more fills
        vm.prank(mm);
        g = gasleft();
        got = book.claimTo(id, 5);
        console2.log("claim via witness (2 fills):", g - gasleft());
        assertGt(got, 0, "witness claim paid real proceeds");

        vm.prank(mm);
        g = gasleft();
        (, uint256 principal0) = book.cancel(id);
        console2.log("cancel via binary-search scan, width 1000:", g - gasleft());
        assertEq(principal0, 996 * uint256(L), "cancel returned the real 996-level tail");
    }
}
