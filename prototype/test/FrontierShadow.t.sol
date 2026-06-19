// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {MockERC20} from "../src/MockERC20.sol";
import {RollingFrontierBook} from "../src/RollingFrontierBook.sol";
import {newBook} from "./utils/BookFab.sol";

/// @notice Experimental shadow liquidity: a pooled inventory layer mirrors
/// real fills 1:1, but never creates levels or doubles maker claims.
contract FrontierShadowTest is Test {
    MockERC20 internal t0;
    MockERC20 internal t1;
    RollingFrontierBook internal book;

    address internal lp;
    address internal mm;
    address internal taker;

    uint128 internal constant L = 1e18;
    uint256 internal constant SHADOW_FEE_BPS = 30;

    function setUp() public {
        lp = makeAddr("shadow-lp");
        mm = makeAddr("maker");
        taker = makeAddr("taker");

        t0 = new MockERC20("T0", "T0");
        t1 = new MockERC20("T1", "T1");
        book = newBook(address(t0), address(t1), 1, 100, address(0), address(0));

        t0.mint(lp, 1e30);
        t1.mint(lp, 1e30);
        vm.startPrank(lp);
        t0.approve(address(book), type(uint256).max);
        t1.approve(address(book), type(uint256).max);
        vm.stopPrank();

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

    function amt1(int24 t, uint256 liq) internal pure returns (uint256) {
        return (liq * uint256(int256(1e18) + int256(t) * 1e15)) / 1e18;
    }

    function shadowFeeUp(uint256 amount1) internal view returns (uint256) {
        return (amount1 * SHADOW_FEE_BPS + 10_000 - 1) / 10_000;
    }

    function shadowFeeDown(uint256 amount1) internal view returns (uint256) {
        return (amount1 * SHADOW_FEE_BPS) / 10_000;
    }

    function testShadowDepositWithdrawIsProRata() public {
        uint256 lp0Start = t0.balanceOf(lp);
        uint256 lp1Start = t1.balanceOf(lp);
        vm.prank(lp);
        (uint256 shares,,) = book.depositShadow(10 * uint256(L), 20 * uint256(L), 0);

        assertEq(lp0Start - t0.balanceOf(lp), 10 * uint256(L), "pulled token0");
        assertEq(lp1Start - t1.balanceOf(lp), 20 * uint256(L), "pulled token1");

        vm.prank(lp);
        book.withdrawShadow(shares / 4, 0, 0);

        assertEq(t0.balanceOf(lp), lp0Start - 7500e15, "pro-rata token0 left in pool");
        assertEq(t1.balanceOf(lp), lp1Start - 15 * uint256(L), "pro-rata token1 left in pool");
    }

    function testShadowBuyMirrorsRealFillWithoutDoublingMakerClaim() public {
        uint256 lp0Start = t0.balanceOf(lp);
        uint256 lp1Start = t1.balanceOf(lp);
        vm.prank(lp);
        (uint256 shares,,) = book.depositShadow(10 * uint256(L), 10 * uint256(L), 0);

        vm.prank(mm);
        uint256 ask = book.deposit(101, 102, L);

        uint256 realCost = amt1(101, L);
        uint256 fee = shadowFeeUp(realCost);
        uint256 maxPay = 2 * realCost + fee;

        uint256 taker0Before = t0.balanceOf(taker);
        uint256 taker1Before = t1.balanceOf(taker);
        vm.prank(taker);
        (int24 reached, uint256 paid, uint256 received) =
            book.sweepWithLimits(102, type(uint256).max, maxPay, 2 * uint256(L), block.timestamp);

        assertEq(reached, 102, "reached");
        assertEq(paid, maxPay, "paid real + shadow + fee");
        assertEq(received, 2 * uint256(L), "real plus shadow token0");
        assertEq(t0.balanceOf(taker) - taker0Before, 2 * uint256(L), "taker received doubled size");
        assertEq(taker1Before - t1.balanceOf(taker), maxPay, "taker paid shadow fee");

        assertEq(book.claimable(ask), realCost, "maker claim is not doubled");

        vm.prank(lp);
        book.withdrawShadow(shares, 0, 0);
        assertEq(t0.balanceOf(lp), lp0Start - uint256(L), "shadow sold only 1x real amount");
        assertEq(t1.balanceOf(lp), lp1Start + realCost + fee, "shadow received quote plus fee");
    }

    function testShadowSellMirrorsRealBidAndBouncesInventory() public {
        uint256 lp0Start = t0.balanceOf(lp);
        uint256 lp1Start = t1.balanceOf(lp);
        vm.prank(lp);
        (uint256 shares,,) = book.depositShadow(10 * uint256(L), 10 * uint256(L), 0);

        vm.prank(mm);
        uint256 bid = book.depositBid(90, 91, L);

        uint256 realOut = amt1(90, L);
        uint256 fee = shadowFeeDown(realOut);

        uint256 taker0Before = t0.balanceOf(taker);
        uint256 taker1Before = t1.balanceOf(taker);
        vm.prank(taker);
        (int24 reached, uint256 paid, uint256 received) =
            book.sweepWithLimits(90, type(uint256).max, 2 * uint256(L), realOut, block.timestamp);

        assertEq(reached, 90, "reached");
        assertEq(paid, 2 * uint256(L), "real plus shadow token0");
        assertEq(received, realOut + realOut - fee, "shadow output net of fee");
        assertEq(taker0Before - t0.balanceOf(taker), 2 * uint256(L), "taker sold doubled size");
        assertEq(t1.balanceOf(taker) - taker1Before, realOut + realOut - fee, "taker output");

        assertEq(book.bidClaimable(bid), L, "maker bid claim is not doubled");

        vm.prank(lp);
        book.withdrawShadow(shares, 0, 0);
        assertEq(t0.balanceOf(lp), lp0Start + uint256(L), "shadow bought token0");
        assertEq(t1.balanceOf(lp), lp1Start - realOut + fee, "shadow paid net quote");
    }

    function testShadowSweepGasDelta() public {
        RollingFrontierBook normalBook = newBook(address(t0), address(t1), 1, 100, address(0), address(0));
        vm.startPrank(mm);
        t0.approve(address(normalBook), type(uint256).max);
        uint256 normalAsk = normalBook.deposit(101, 151, L);
        vm.stopPrank();
        vm.prank(taker);
        t1.approve(address(normalBook), type(uint256).max);

        uint256 normalBudget = type(uint256).max;
        vm.prank(taker);
        uint256 g = gasleft();
        normalBook.sweepWithLimits(151, type(uint256).max, normalBudget, 0, block.timestamp);
        uint256 normalGas = g - gasleft();
        assertGt(normalBook.claimable(normalAsk), 0, "normal sanity");

        vm.prank(lp);
        book.depositShadow(100 * uint256(L), 100 * uint256(L), 0);
        vm.prank(mm);
        book.deposit(101, 151, L);
        uint256 realCost = 0;
        for (int24 t = 101; t < 151; t++) realCost += amt1(t, L);
        uint256 shadowBudget = 2 * realCost + shadowFeeUp(realCost);

        vm.prank(taker);
        g = gasleft();
        book.sweepWithLimits(151, type(uint256).max, shadowBudget, 0, block.timestamp);
        uint256 shadowGas = g - gasleft();

        console2.log("normal sweep 50 levels gas:", normalGas);
        console2.log("shadow sweep 50 levels gas:", shadowGas);
        if (shadowGas >= normalGas) console2.log("shadow overhead gas:", shadowGas - normalGas);
        else console2.log("shadow discount in this warm test gas:", normalGas - shadowGas);
        assertLt(shadowGas, normalGas + 120_000, "shadow overhead should stay bounded");
    }
}
