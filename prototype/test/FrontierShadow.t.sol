// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {MockERC20} from "../src/MockERC20.sol";
import {UniformFrontierBook} from "../src/UniformFrontierBook.sol";
import {newBookWithFees} from "./utils/BookFab.sol";

contract FrontierShadowTest is Test {
    MockERC20 internal t0;
    MockERC20 internal t1;
    UniformFrontierBook internal book;

    address internal maker = makeAddr("maker");
    address internal taker = makeAddr("taker");
    address internal lp = makeAddr("lp");
    address internal lp2 = makeAddr("lp2");
    address internal feeRecipient = makeAddr("feeRecipient");

    uint128 internal constant L = 1e18;
    uint256 internal constant SHADOW_FEE_BPS = 30;
    uint256 internal constant BPS = 10_000;

    function setUp() public {
        t0 = new MockERC20("T0", "T0");
        t1 = new MockERC20("T1", "T1");
        // Fee recipient set, maker/taker bps = 0: isolates the copy fee so the
        // economic assertions read cleanly. The copy fee routes to the
        // protocol (feeRecipient), never back into the pool.
        book = newBookWithFees(address(t0), address(t1), 1, 100, address(0), address(0), feeRecipient, 0, 0);

        address[4] memory users = [maker, taker, lp, lp2];
        for (uint256 i = 0; i < users.length; i++) {
            t0.mint(users[i], 1e30);
            t1.mint(users[i], 1e30);
            vm.startPrank(users[i]);
            t0.approve(address(book), type(uint256).max);
            t1.approve(address(book), type(uint256).max);
            vm.stopPrank();
        }
    }

    function _rate(int24 t) internal pure returns (uint256) {
        return uint256(int256(1e18) + int256(t) * 1e15);
    }

    function _ceilSpan1(int24 a, int24 b, uint256 size) internal pure returns (uint256 v) {
        uint256 acc;
        for (int24 t = a; t < b; t++) {
            acc += size * _rate(t);
        }
        return (acc + 1e18 - 1) / 1e18;
    }

    function _floorSpan1(int24 a, int24 b, uint256 size) internal pure returns (uint256 v) {
        uint256 acc;
        for (int24 t = a; t < b; t++) {
            acc += size * _rate(t);
        }
        return acc / 1e18;
    }

    function _shadowFee(uint256 amount) internal pure returns (uint256) {
        return (amount * SHADOW_FEE_BPS) / BPS;
    }

    function _seedShadow() internal returns (uint256 shares) {
        vm.prank(lp);
        (shares,,) = book.depositShadow(10 * uint256(L), 10_000 * uint256(L), 0);
    }

    function testShadowDepositWithdrawIsProRata() public {
        vm.prank(lp);
        (uint256 shares,,) = book.depositShadow(100 ether, 500 ether, 0);
        assertEq(shares, 600 ether, "first shares");

        vm.prank(lp2);
        (uint256 shares2, uint256 used0, uint256 used1) = book.depositShadow(100 ether, 1000 ether, 0);
        assertEq(shares2, 600 ether, "second shares at pool ratio");
        assertEq(used0, 100 ether, "amount0 clipped");
        assertEq(used1, 500 ether, "amount1 clipped");
        assertEq(book.shadowSharesOf(lp2), 600 ether, "shares stored");

        uint256 before0 = t0.balanceOf(lp2);
        uint256 before1 = t1.balanceOf(lp2);
        vm.prank(lp2);
        (uint256 out0, uint256 out1) = book.withdrawShadow(shares2, 0, 0);

        assertEq(out0, 100 ether, "withdraw amount0");
        assertEq(out1, 500 ether, "withdraw amount1");
        assertEq(t0.balanceOf(lp2) - before0, out0, "token0 returned");
        assertEq(t1.balanceOf(lp2) - before1, out1, "token1 returned");
    }

    function testShadowAskMirrorsRealFillAndLeavesMakerClaimUnchanged() public {
        _seedShadow();
        vm.prank(maker);
        uint256 id = book.deposit(101, 103, L);

        // Shadow mirrors the real token1 input 1:1 at book price (no premium);
        // its fee is taken from that token1 and routed to the protocol, so the
        // taker pays exactly 2x the real input and the pool keeps input - fee.
        uint256 realPaid = _ceilSpan1(101, 103, L);
        uint256 shadowFee = _shadowFee(realPaid);
        vm.prank(taker);
        (int24 reached, uint256 paid, uint256 received) =
            book.sweepWithLimits(103, type(uint256).max, type(uint256).max, 0, block.timestamp);

        assertEq(reached, 103, "reached target");
        assertEq(paid, 2 * realPaid, "real plus shadow input, no premium");
        assertEq(received, 4 * uint256(L), "real output doubled by shadow");
        assertEq(book.claimable(id), _floorSpan1(101, 103, L), "maker claim is real-only");
        assertEq(t1.balanceOf(feeRecipient), shadowFee, "copy fee routed to protocol");

        (uint256 r0, uint256 r1,) = book.shadowReserves();
        assertEq(r0, 8 * uint256(L), "shadow sold token0");
        assertEq(r1, 10_000 * uint256(L) + realPaid - shadowFee, "shadow keeps input net of fee");
    }

    function testShadowBidMirrorsRealFillAndBouncesInventory() public {
        _seedShadow();
        vm.prank(maker);
        uint256 id = book.depositBid(97, 100, L);

        uint256 realOut = _floorSpan1(97, 100, L);
        uint256 shadowFee = _shadowFee(realOut);
        vm.prank(taker);
        (int24 reached, uint256 paid, uint256 received) =
            book.sweepWithLimits(97, type(uint256).max, type(uint256).max, 0, block.timestamp);

        assertEq(reached, 97, "reached target");
        assertEq(paid, 6 * uint256(L), "real input doubled by shadow");
        assertEq(received, 2 * realOut - shadowFee, "shadow output net of fee");
        assertEq(book.bidClaimable(id), 3 * uint256(L), "maker claim is real-only");
        assertEq(t1.balanceOf(feeRecipient), shadowFee, "copy fee routed to protocol");

        // Pool pays the full token1 leg; the fee is carved out of the taker's
        // output and sent to the protocol, not retained by the pool.
        (uint256 r0, uint256 r1,) = book.shadowReserves();
        assertEq(r0, 13 * uint256(L), "shadow bought token0");
        assertEq(r1, 10_000 * uint256(L) - realOut, "shadow paid full token1 leg");
    }

    function testFiniteBudgetSplitsBetweenRealAndShadow() public {
        _seedShadow();
        vm.prank(maker);
        book.deposit(101, 103, L);

        // No premium on the taker: budget splits evenly between the real level
        // and its shadow mirror. The copy fee is paid by the pool, not added
        // to the taker's spend.
        uint256 oneLevel = _ceilSpan1(101, 102, L);
        uint256 maxPay = 2 * oneLevel;
        vm.prank(taker);
        (int24 reached, uint256 paid, uint256 received) =
            book.sweepWithLimits(103, type(uint256).max, maxPay, 0, block.timestamp);

        assertEq(reached, 102, "real fill parks after one level");
        assertEq(paid, maxPay, "budget spent on one real and one shadow level");
        assertEq(received, 2 * uint256(L), "one real level plus one shadow level");
        assertEq(t1.balanceOf(feeRecipient), _shadowFee(oneLevel), "copy fee routed to protocol");
    }

    /// @notice With no fee recipient the copy fee is zero: the pool mirrors at
    /// pure book price and never attempts a transfer to address(0).
    function testShadowFeelessWhenNoRecipient() public {
        UniformFrontierBook freeBook =
            newBookWithFees(address(t0), address(t1), 1, 100, address(0), address(0), address(0), 0, 0);
        vm.startPrank(lp);
        t0.approve(address(freeBook), type(uint256).max);
        t1.approve(address(freeBook), type(uint256).max);
        freeBook.depositShadow(10 * uint256(L), 10_000 * uint256(L), 0);
        vm.stopPrank();
        vm.prank(maker);
        t0.approve(address(freeBook), type(uint256).max);
        vm.prank(maker);
        freeBook.deposit(101, 103, L);

        uint256 realPaid = _ceilSpan1(101, 103, L);
        vm.prank(taker);
        t1.approve(address(freeBook), type(uint256).max);
        vm.prank(taker);
        (, uint256 paid, uint256 received) =
            freeBook.sweepWithLimits(103, type(uint256).max, type(uint256).max, 0, block.timestamp);

        assertEq(paid, 2 * realPaid, "no premium");
        assertEq(received, 4 * uint256(L), "full mirror");
        (, uint256 r1,) = freeBook.shadowReserves();
        assertEq(r1, 10_000 * uint256(L) + realPaid, "pool keeps full input, no fee carved");
    }

    function _cool(address targetBook) internal {
        vm.cool(targetBook);
        vm.cool(address(t0));
        vm.cool(address(t1));
    }

    function testGasRealOnlySweep50Levels() public {
        vm.prank(maker);
        book.deposit(101, 151, L);

        _cool(address(book));
        vm.prank(taker);
        uint256 gasBefore = gasleft();
        (int24 reached,, uint256 received) =
            book.sweepWithLimits(151, type(uint256).max, type(uint256).max, 0, block.timestamp);
        uint256 realOnlyGas = gasBefore - gasleft();

        assertEq(reached, 151, "real-only reached");
        assertEq(received, 50 * uint256(L), "real-only received");
        console2.log("real-only sweep gas:", realOnlyGas);
        console2.log("real-only received:", received);
    }

    function testGasRealOnlySweep50LevelsPreseededQuoteBalance() public {
        vm.prank(maker);
        book.deposit(101, 151, L);
        vm.prank(lp);
        t1.transfer(address(book), 1);

        _cool(address(book));
        vm.prank(taker);
        uint256 gasBefore = gasleft();
        (int24 reached,, uint256 received) =
            book.sweepWithLimits(151, type(uint256).max, type(uint256).max, 0, block.timestamp);
        uint256 realOnlyGas = gasBefore - gasleft();

        assertEq(reached, 151, "real-only reached");
        assertEq(received, 50 * uint256(L), "real-only received");
        console2.log("real-only preseeded sweep gas:", realOnlyGas);
    }

    function testGasShadowSweep50Levels() public {
        vm.prank(lp);
        book.depositShadow(100 * uint256(L), 100_000 * uint256(L), 0);
        vm.prank(maker);
        book.deposit(101, 151, L);

        _cool(address(book));
        vm.prank(taker);
        uint256 gasBefore = gasleft();
        (int24 reached,, uint256 received) =
            book.sweepWithLimits(151, type(uint256).max, type(uint256).max, 0, block.timestamp);
        uint256 shadowGas = gasBefore - gasleft();

        assertEq(reached, 151, "shadow reached");
        assertEq(received, 100 * uint256(L), "shadow received");
        console2.log("shadow sweep gas:", shadowGas);
        console2.log("shadow received:", received);
    }

    function testGasRealOnlyDownSweep50Levels() public {
        vm.prank(maker);
        book.depositBid(50, 100, L);

        _cool(address(book));
        vm.prank(taker);
        uint256 gasBefore = gasleft();
        (int24 reached,, uint256 received) =
            book.sweepWithLimits(50, type(uint256).max, type(uint256).max, 0, block.timestamp);
        uint256 realOnlyGas = gasBefore - gasleft();

        assertEq(reached, 50, "real-only reached");
        assertEq(received, _floorSpan1(50, 100, L), "real-only received");
        console2.log("real-only down sweep gas:", realOnlyGas);
    }

    function testGasRealOnlyDownSweep50LevelsPreseededBaseBalance() public {
        vm.prank(maker);
        book.depositBid(50, 100, L);
        vm.prank(lp);
        t0.transfer(address(book), 1);

        _cool(address(book));
        vm.prank(taker);
        uint256 gasBefore = gasleft();
        (int24 reached,, uint256 received) =
            book.sweepWithLimits(50, type(uint256).max, type(uint256).max, 0, block.timestamp);
        uint256 realOnlyGas = gasBefore - gasleft();

        assertEq(reached, 50, "real-only reached");
        assertEq(received, _floorSpan1(50, 100, L), "real-only received");
        console2.log("real-only preseeded down sweep gas:", realOnlyGas);
    }

    function testGasShadowDownSweep50Levels() public {
        vm.prank(lp);
        book.depositShadow(100 * uint256(L), 100_000 * uint256(L), 0);
        vm.prank(maker);
        book.depositBid(50, 100, L);

        _cool(address(book));
        vm.prank(taker);
        uint256 gasBefore = gasleft();
        (int24 reached,, uint256 received) =
            book.sweepWithLimits(50, type(uint256).max, type(uint256).max, 0, block.timestamp);
        uint256 shadowGas = gasBefore - gasleft();

        assertEq(reached, 50, "shadow reached");
        assertGt(received, _floorSpan1(50, 100, L), "shadow output includes mirror");
        console2.log("shadow down sweep gas:", shadowGas);
        console2.log("shadow down received:", received);
    }

    function testShadowPoolGas() public {
        _cool(address(book));
        vm.prank(lp);
        uint256 gasBefore = gasleft();
        (uint256 shares,,) = book.depositShadow(100 * uint256(L), 100_000 * uint256(L), 0);
        uint256 firstDepositGas = gasBefore - gasleft();

        _cool(address(book));
        vm.prank(lp2);
        gasBefore = gasleft();
        book.depositShadow(100 * uint256(L), 100_000 * uint256(L), 0);
        uint256 secondDepositGas = gasBefore - gasleft();

        _cool(address(book));
        vm.prank(lp);
        gasBefore = gasleft();
        book.withdrawShadow(shares / 2, 0, 0);
        uint256 withdrawGas = gasBefore - gasleft();

        console2.log("shadow first deposit gas:", firstDepositGas);
        console2.log("shadow pro-rata deposit gas:", secondDepositGas);
        console2.log("shadow withdraw gas:", withdrawGas);
    }
}
