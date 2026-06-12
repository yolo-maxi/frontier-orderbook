// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MockERC20} from "../src/MockERC20.sol";
import {RollingFrontierBook} from "../src/RollingFrontierBook.sol";
import {newBookWithMakerFees} from "./utils/BookFab.sol";

contract MakerAgeRebatesTest is Test {
    MockERC20 internal t0;
    MockERC20 internal t1;
    RollingFrontierBook internal book;

    address internal mm = makeAddr("mm");
    address internal buyer = makeAddr("buyer");
    address internal seller = makeAddr("seller");
    address internal feeRecipient = makeAddr("feeRecipient");
    address internal receiver = makeAddr("receiver");

    uint128 internal constant L = 1e18;
    uint16 internal constant MAKER_FEE_BPS = 1_000;

    function setUp() public {
        _deployBook(0, MAKER_FEE_BPS);
    }

    function _deployBook(int24 startTick, uint16 feeBps) internal {
        t0 = new MockERC20("T0", "T0");
        t1 = new MockERC20("T1", "T1");
        book = newBookWithMakerFees(
            address(t0), address(t1), 1, startTick, address(0), address(0), address(this), feeRecipient, feeBps
        );

        t0.mint(mm, 1e30);
        t1.mint(mm, 1e30);
        vm.startPrank(mm);
        t0.approve(address(book), type(uint256).max);
        t1.approve(address(book), type(uint256).max);
        vm.stopPrank();

        t1.mint(buyer, 1e30);
        vm.prank(buyer);
        t1.approve(address(book), type(uint256).max);

        t0.mint(seller, 1e30);
        vm.prank(seller);
        t0.approve(address(book), type(uint256).max);
    }

    function _rate(int24 t) internal pure returns (uint256) {
        return uint256(int256(1e18) + int256(t) * 1e15);
    }

    function _askGross(int24 lower, int24 upper) internal pure returns (uint256 gross) {
        for (int24 t = lower; t < upper; t++) {
            gross += (uint256(L) * _rate(t)) / 1e18;
        }
    }

    function _fee(uint256 gross, uint16 rebateBps) internal pure returns (uint256) {
        uint256 baseFee = (gross * MAKER_FEE_BPS) / 10_000;
        return (baseFee * (10_000 - rebateBps)) / 10_000;
    }

    function _depositAsk(int24 lower, int24 upper) internal returns (uint256 id) {
        vm.prank(mm);
        id = book.deposit(lower, upper, L);
    }

    function _fillAsk(int24 target) internal {
        vm.prank(buyer);
        book.moveTickTo(target);
    }

    function _depositBid(int24 lower, int24 upper) internal returns (uint256 id) {
        vm.prank(mm);
        id = book.depositBid(lower, upper, L);
    }

    function _fillBid(int24 target) internal {
        vm.prank(seller);
        book.moveTickTo(target);
    }

    function testZeroMakerFeePreservesOldAskClaimBehavior() public {
        _deployBook(0, 0);
        uint256 id = _depositAsk(1, 3);
        _fillAsk(3);

        uint256 gross = _askGross(1, 3);
        uint256 before = t1.balanceOf(mm);
        vm.prank(mm);
        uint256 paid = book.claim(id);

        assertEq(paid, gross, "zero fee pays gross");
        assertEq(t1.balanceOf(mm) - before, gross, "maker receives gross");
        assertEq(t1.balanceOf(feeRecipient), 0, "no fee");
    }

    function testFreshSameEpochClaimGetsNoRebate() public {
        uint256 id = _depositAsk(1, 2);
        _fillAsk(2);

        uint256 gross = _askGross(1, 2);
        uint256 fee = _fee(gross, 0);
        vm.prank(mm);
        uint256 paid = book.claim(id);

        assertEq(book.ageRebateBps(id), 0, "same epoch rebate");
        assertEq(paid, gross - fee, "maker receives net");
        assertEq(t1.balanceOf(feeRecipient), fee, "fee recipient");
    }

    function testOlderAskGetsPartialAndFullRebates() public {
        uint256 partialId = _depositAsk(1, 2);
        vm.warp(block.timestamp + 4 hours);
        _fillAsk(2);

        uint256 gross = _askGross(1, 2);
        uint256 fee = _fee(gross, 5_000);
        vm.prank(mm);
        uint256 paid = book.claim(partialId);
        assertEq(book.ageRebateBps(partialId), 5_000, "medium rebate");
        assertEq(paid, gross - fee, "medium net");
        assertEq(t1.balanceOf(feeRecipient), fee, "medium fee");

        _fillAsk(0);
        uint256 full = _depositAsk(1, 2);
        vm.warp(block.timestamp + 24 hours);
        _fillAsk(2);

        vm.prank(mm);
        paid = book.claim(full);
        assertEq(book.ageRebateBps(full), 10_000, "long rebate");
        assertEq(paid, gross, "full rebate pays gross");
        assertEq(t1.balanceOf(feeRecipient), fee, "no additional fee");
    }

    function testBidClaimAppliesAgeRebateAndFeeRecipientAccounting() public {
        _deployBook(100, MAKER_FEE_BPS);
        uint256 id = _depositBid(90, 91);
        vm.warp(block.timestamp + 1 hours);
        _fillBid(90);

        uint256 gross = uint256(L);
        uint256 fee = _fee(gross, 2_500);
        vm.prank(mm);
        uint256 paid = book.claimBid(id);

        assertEq(book.ageRebateBps(id), 2_500, "short bid rebate");
        assertEq(paid, gross - fee, "bid net token0");
        assertEq(t0.balanceOf(feeRecipient), fee, "bid fee recipient");
        assertEq(t0.balanceOf(mm), 1e30 + gross - fee, "maker token0");
    }

    function testInternalClaimDoesNotResetRestingAge() public {
        uint256 id = _depositAsk(1, 3);
        vm.warp(block.timestamp + 4 hours);
        _fillAsk(2);

        uint256 firstGross = _askGross(1, 2);
        uint256 firstFee = _fee(firstGross, 5_000);
        vm.prank(mm);
        uint256 firstPaid = book.claimInternal(id);
        assertEq(firstPaid, firstGross - firstFee, "internal net");
        assertEq(book.internalBalance1(mm), firstGross - firstFee, "internal credit");

        vm.warp(block.timestamp + 20 hours);
        _fillAsk(3);

        uint256 secondGross = _askGross(2, 3);
        vm.prank(mm);
        uint256 secondPaid = book.claim(id);
        assertEq(book.ageRebateBps(id), 10_000, "age kept across internal claim");
        assertEq(secondPaid, secondGross, "full rebate after original long rest");
        assertEq(t1.balanceOf(feeRecipient), firstFee, "no second fee");
    }

    function testRequoteResizeMoveResetsRestingAge() public {
        uint256 id = _depositAsk(10, 12);
        vm.warp(block.timestamp + 24 hours);

        vm.prank(mm);
        book.requote(id, 20, 21, L);
        _fillAsk(21);

        uint256 gross = _askGross(20, 21);
        uint256 fee = _fee(gross, 0);
        vm.prank(mm);
        uint256 paid = book.claim(id);

        assertEq(book.ageRebateBps(id), 0, "requote resets age");
        assertEq(paid, gross - fee, "full fee after reset");
        assertEq(t1.balanceOf(feeRecipient), fee, "fee after reset");
    }

    function testTransferPreservesRestingAge() public {
        uint256 id = _depositAsk(1, 2);
        vm.warp(block.timestamp + 24 hours);

        vm.prank(mm);
        book.transferPosition(id, receiver);
        _fillAsk(2);

        uint256 gross = _askGross(1, 2);
        vm.prank(receiver);
        uint256 paid = book.claim(id);

        assertEq(book.ageRebateBps(id), 10_000, "transfer preserves age");
        assertEq(paid, gross, "new owner receives full rebate");
        assertEq(t1.balanceOf(receiver), gross, "receiver paid");
        assertEq(t1.balanceOf(feeRecipient), 0, "no fee after full rebate");
    }
}
