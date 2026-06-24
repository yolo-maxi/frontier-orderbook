// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MockERC20} from "../src/MockERC20.sol";
import {UniformFrontierBook} from "../src/UniformFrontierBook.sol";
import {GeometricFrontierBook} from "../src/GeometricFrontierBook.sol";
import {FrontierLens} from "../src/periphery/FrontierLens.sol";
import {newBookWithFees, newGeoBookWithFees} from "./utils/BookFab.sol";

contract MakerTakerFeesFuzzTest is Test {
    MockERC20 internal t0;
    MockERC20 internal t1;
    address internal maker = makeAddr("maker");
    address internal taker = makeAddr("taker");
    address internal feeRecipient = makeAddr("feeRecipient");

    function _setupTokens(address book) internal {
        t0.mint(maker, 1e32);
        t1.mint(maker, 1e32);
        vm.startPrank(maker);
        t0.approve(book, type(uint256).max);
        t1.approve(book, type(uint256).max);
        vm.stopPrank();

        t0.mint(taker, 1e32);
        t1.mint(taker, 1e32);
        vm.startPrank(taker);
        t0.approve(book, type(uint256).max);
        t1.approve(book, type(uint256).max);
        vm.stopPrank();
    }

    function _newLinear(uint16 makerFeeBps, uint16 takerFeeBps) internal returns (UniformFrontierBook book) {
        t0 = new MockERC20("T0", "T0");
        t1 = new MockERC20("T1", "T1");
        book = newBookWithFees(
            address(t0), address(t1), 1, 100, address(0), address(0), feeRecipient, makerFeeBps, takerFeeBps
        );
        _setupTokens(address(book));
    }

    function _newGeo(uint16 makerFeeBps, uint16 takerFeeBps) internal returns (GeometricFrontierBook book) {
        t0 = new MockERC20("T0", "T0");
        t1 = new MockERC20("T1", "T1");
        book = newGeoBookWithFees(
            address(t0), address(t1), 60, 0, address(0), address(0), feeRecipient, makerFeeBps, takerFeeBps
        );
        _setupTokens(address(book));
    }

    function _rate(int24 t) internal pure returns (uint256) {
        return uint256(int256(1e18) + int256(t) * 1e15);
    }

    function _ceilSpan1(int24 a, int24 b, uint256 size) internal pure returns (uint256 v) {
        uint256 acc;
        for (int24 t = a; t < b; t++) acc += size * _rate(t);
        return (acc + 1e18 - 1) / 1e18;
    }

    function _floorSpan1(int24 a, int24 b, uint256 size) internal pure returns (uint256 v) {
        uint256 acc;
        for (int24 t = a; t < b; t++) acc += size * _rate(t);
        return acc / 1e18;
    }

    function _fee(uint256 amount, uint16 bps) internal pure returns (uint256) {
        return (amount * bps) / 10_000;
    }

    function testFuzz_LinearAskFeesConserve(uint16 makerFeeBps, uint16 takerFeeBps, uint96 rawSize, uint8 rawWidth)
        public
    {
        makerFeeBps = uint16(bound(makerFeeBps, 0, 1_000));
        takerFeeBps = uint16(bound(takerFeeBps, 0, 1_000));
        uint128 size = uint128(bound(rawSize, 1e6, 1e24));
        int24 width = int24(uint24(bound(rawWidth, 1, 20)));
        UniformFrontierBook book = _newLinear(makerFeeBps, takerFeeBps);

        vm.prank(maker);
        uint256 id = book.deposit(101, 101 + width, size);

        uint256 grossInput = _ceilSpan1(101, 101 + width, size);
        uint256 takerFee = _fee(grossInput, takerFeeBps);
        vm.prank(taker);
        (, uint256 paid, uint256 received) =
            book.sweepWithLimits(101 + width, type(uint256).max, type(uint256).max, 0, block.timestamp);
        assertEq(paid, grossInput + takerFee, "taker pays gross plus fee");
        assertEq(received, uint256(size) * uint256(uint24(width)), "taker output unchanged");

        uint256 grossClaim = _floorSpan1(101, 101 + width, size);
        uint256 makerFee = _fee(grossClaim, makerFeeBps);
        assertEq(book.claimable(id), grossClaim - makerFee, "claimable is net");
        vm.prank(maker);
        assertEq(book.claim(id), grossClaim - makerFee, "claim returns net");
        assertEq(t1.balanceOf(feeRecipient), takerFee + makerFee, "token1 fee accounting");
    }

    function testFuzz_LinearBidFeesConserve(uint16 makerFeeBps, uint16 takerFeeBps, uint96 rawSize, uint8 rawWidth)
        public
    {
        makerFeeBps = uint16(bound(makerFeeBps, 0, 1_000));
        takerFeeBps = uint16(bound(takerFeeBps, 0, 1_000));
        uint128 size = uint128(bound(rawSize, 1e6, 1e24));
        int24 width = int24(uint24(bound(rawWidth, 1, 20)));
        UniformFrontierBook book = _newLinear(makerFeeBps, takerFeeBps);
        int24 lower = 100 - width;

        vm.prank(maker);
        uint256 id = book.depositBid(lower, 100, size);

        uint256 grossInput = uint256(size) * uint256(uint24(width));
        uint256 takerFee = _fee(grossInput, takerFeeBps);
        vm.prank(taker);
        (, uint256 paid,) = book.sweepWithLimits(lower, type(uint256).max, type(uint256).max, 0, block.timestamp);
        assertEq(paid, grossInput + takerFee, "taker pays gross plus fee");

        uint256 makerFee = _fee(grossInput, makerFeeBps);
        assertEq(book.bidClaimable(id), grossInput - makerFee, "bid claimable is net");
        vm.prank(maker);
        assertEq(book.claimBid(id), grossInput - makerFee, "bid claim returns net");
        assertEq(t0.balanceOf(feeRecipient), takerFee + makerFee, "token0 fee accounting");
    }

    function testFuzz_GeometricAskFeesMatchLens(uint16 makerFeeBps, uint16 takerFeeBps, uint96 rawSize, uint8 rawWidth)
        public
    {
        makerFeeBps = uint16(bound(makerFeeBps, 0, 1_000));
        takerFeeBps = uint16(bound(takerFeeBps, 0, 1_000));
        uint128 size = uint128(bound(rawSize, 1e6, 1e24));
        uint256 levels = bound(rawWidth, 1, 8);
        int24 upper = int24(uint24(60 * levels + 60));
        GeometricFrontierBook book = _newGeo(makerFeeBps, takerFeeBps);
        FrontierLens lens = new FrontierLens();

        vm.prank(maker);
        uint256 id = book.deposit(60, upper, size);

        (uint256 quotedOut, uint256 quotedSpent,) = lens.quoteBuy(book, type(uint256).max);
        uint256 takerBefore = t1.balanceOf(taker);
        vm.prank(taker);
        (, uint256 paid, uint256 received) = book.sweepWithLimits(upper, type(uint256).max, type(uint256).max, 0, block.timestamp);
        assertEq(received, quotedOut, "geo taker output matches lens");
        assertEq(paid, quotedSpent, "geo taker paid matches lens including fee");
        assertEq(takerBefore - t1.balanceOf(taker), paid, "geo exact taker debit");

        uint256 netClaimable = book.claimable(id);
        uint256 recipientBefore = t1.balanceOf(feeRecipient);
        vm.prank(maker);
        assertEq(book.claim(id), netClaimable, "geo maker claim returns net");
        assertGe(t1.balanceOf(feeRecipient), recipientBefore, "geo maker fee nondecreasing");
    }
}
