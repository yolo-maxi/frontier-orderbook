// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.24;

import "../src/FrontierErrors.sol";

import {Test} from "forge-std/Test.sol";
import {MockERC20} from "../src/MockERC20.sol";
import {UniformFrontierBook} from "../src/UniformFrontierBook.sol";
import {UniformMakerOps} from "../src/UniformMakerOps.sol";
import {FrontierLens} from "../src/periphery/FrontierLens.sol";
import {newBookWithFees} from "./utils/BookFab.sol";

contract FeeShortTransferToken {
    string public name = "Short";
    string public symbol = "SHORT";
    uint8 public constant decimals = 18;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        uint256 moved = amount == 0 ? 0 : amount - 1;
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += moved;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) allowance[from][msg.sender] = allowed - amount;
        uint256 moved = amount == 0 ? 0 : amount - 1;
        balanceOf[from] -= amount;
        balanceOf[to] += moved;
        return true;
    }
}

contract MakerTakerFeesTest is Test {
    MockERC20 internal t0;
    MockERC20 internal t1;

    address internal maker = makeAddr("maker");
    address internal taker = makeAddr("taker");
    address internal feeRecipient = makeAddr("feeRecipient");

    uint128 internal constant L = 1e18;
    uint16 internal constant MAKER_FEE_BPS = 100;
    uint16 internal constant TAKER_FEE_BPS = 50;

    function _newBook(uint16 makerFeeBps, uint16 takerFeeBps) internal returns (UniformFrontierBook book) {
        t0 = new MockERC20("T0", "T0");
        t1 = new MockERC20("T1", "T1");
        book = newBookWithFees(
            address(t0), address(t1), 1, 100, address(0), address(0), feeRecipient, makerFeeBps, takerFeeBps
        );

        t0.mint(maker, 1e30);
        t1.mint(maker, 1e30);
        vm.startPrank(maker);
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

    function _fee(uint256 amount, uint16 bps) internal pure returns (uint256) {
        return (amount * bps) / 10_000;
    }

    function testZeroFeesPreserveOldBehavior() public {
        UniformFrontierBook book = _newBook(0, 0);

        vm.prank(maker);
        uint256 id = book.deposit(101, 103, L);

        uint256 grossInput = _ceilSpan1(101, 103, L);
        vm.prank(taker);
        (int24 reached, uint256 paid, uint256 received) =
            book.sweepWithLimits(103, type(uint256).max, type(uint256).max, 0, block.timestamp);

        assertEq(reached, 103, "reached target");
        assertEq(paid, grossInput, "zero-fee paid amount unchanged");
        assertEq(received, 2 * uint256(L), "zero-fee output unchanged");

        uint256 proceeds = _floorSpan1(101, 103, L);
        assertEq(book.claimable(id), proceeds, "zero-fee claimable unchanged");
        vm.prank(maker);
        assertEq(book.claim(id), proceeds, "zero-fee claim unchanged");
        assertEq(t0.balanceOf(feeRecipient), 0, "no token0 fees");
        assertEq(t1.balanceOf(feeRecipient), 0, "no token1 fees");
    }

    function testMakerAskClaimFee() public {
        UniformFrontierBook book = _newBook(MAKER_FEE_BPS, 0);

        vm.prank(maker);
        uint256 id = book.deposit(101, 103, L);
        vm.prank(taker);
        book.moveTickTo(103);

        uint256 gross = _floorSpan1(101, 103, L);
        uint256 fee = _fee(gross, MAKER_FEE_BPS);
        assertEq(book.claimable(id), gross - fee, "claimable is net of maker fee");

        uint256 makerBefore = t1.balanceOf(maker);
        vm.prank(maker);
        uint256 net = book.claim(id);

        assertEq(net, gross - fee, "claim returns net proceeds");
        assertEq(t1.balanceOf(maker) - makerBefore, net, "maker receives net");
        assertEq(t1.balanceOf(feeRecipient), fee, "recipient receives maker fee");
    }

    function testMakerBidClaimFee() public {
        UniformFrontierBook book = _newBook(MAKER_FEE_BPS, 0);

        vm.prank(maker);
        uint256 id = book.depositBid(95, 97, L);
        vm.prank(taker);
        book.moveTickTo(95);

        uint256 gross = 2 * uint256(L);
        uint256 fee = _fee(gross, MAKER_FEE_BPS);
        assertEq(book.bidClaimable(id), gross - fee, "bid claimable is net of maker fee");

        uint256 makerBefore = t0.balanceOf(maker);
        vm.prank(maker);
        uint256 net = book.claimBid(id);

        assertEq(net, gross - fee, "bid claim returns net proceeds");
        assertEq(t0.balanceOf(maker) - makerBefore, net, "maker receives net token0");
        assertEq(t0.balanceOf(feeRecipient), fee, "recipient receives bid maker fee");
    }

    function testTakerUpSweepFee() public {
        UniformFrontierBook book = _newBook(0, TAKER_FEE_BPS);

        vm.prank(maker);
        book.deposit(101, 103, L);

        uint256 grossInput = _ceilSpan1(101, 103, L);
        uint256 fee = _fee(grossInput, TAKER_FEE_BPS);
        uint256 takerBefore = t1.balanceOf(taker);

        FrontierLens lens = new FrontierLens();
        (uint256 quotedOut, uint256 quotedSpent,) = lens.quoteBuy(book, type(uint256).max);
        assertEq(quotedOut, 2 * uint256(L), "lens output not reduced by fee");
        assertEq(quotedSpent, grossInput + fee, "lens buy quote includes taker fee");

        vm.prank(taker);
        (int24 reached, uint256 paid, uint256 received) =
            book.sweepWithLimits(103, type(uint256).max, type(uint256).max, 0, block.timestamp);

        assertEq(reached, 103, "reached target");
        assertEq(paid, grossInput + fee, "paid includes taker fee");
        assertEq(received, 2 * uint256(L), "maker output not reduced");
        assertEq(takerBefore - t1.balanceOf(taker), grossInput + fee, "taker pays input plus fee");
        assertEq(t1.balanceOf(feeRecipient), fee, "recipient receives taker token1 fee");
    }

    function testTakerDownSweepFee() public {
        UniformFrontierBook book = _newBook(0, TAKER_FEE_BPS);

        vm.prank(maker);
        book.depositBid(95, 97, L);

        uint256 grossInput = 2 * uint256(L);
        uint256 fee = _fee(grossInput, TAKER_FEE_BPS);
        uint256 takerBefore = t0.balanceOf(taker);
        uint256 expectedOut = (uint256(L) * _rate(96)) / 1e18 + (uint256(L) * _rate(95)) / 1e18;

        FrontierLens lens = new FrontierLens();
        (uint256 quotedOut, uint256 quotedSpent,) = lens.quoteSell(book, type(uint256).max, 16);
        assertEq(quotedOut, expectedOut, "lens output not reduced by fee");
        assertEq(quotedSpent, grossInput + fee, "lens sell quote includes taker fee");

        vm.prank(taker);
        (int24 reached, uint256 paid, uint256 received) =
            book.sweepWithLimits(95, type(uint256).max, type(uint256).max, 0, block.timestamp);

        assertEq(reached, 95, "reached target");
        assertEq(paid, grossInput + fee, "paid includes taker fee");
        assertEq(received, expectedOut, "output unchanged");
        assertEq(takerBefore - t0.balanceOf(taker), grossInput + fee, "taker pays input plus fee");
        assertEq(t0.balanceOf(feeRecipient), fee, "recipient receives taker token0 fee");
    }

    function testExactTransferProtectionStillHoldsWithTakerFees() public {
        MockERC20 token0 = new MockERC20("T0", "T0");
        FeeShortTransferToken shortToken1 = new FeeShortTransferToken();
        UniformFrontierBook book = newBookWithFees(
            address(token0), address(shortToken1), 1, 100, address(0), address(0), feeRecipient, 0, TAKER_FEE_BPS
        );

        token0.mint(maker, 10e18);
        vm.startPrank(maker);
        token0.approve(address(book), type(uint256).max);
        book.deposit(101, 102, 1e18);
        vm.stopPrank();

        shortToken1.mint(taker, 10e18);
        vm.startPrank(taker);
        shortToken1.approve(address(book), type(uint256).max);
        vm.expectRevert(NonExactTransfer.selector);
        book.sweepWithLimits(102, type(uint256).max, type(uint256).max, 0, block.timestamp);
        vm.stopPrank();
    }

    function testFeeConstructorCapsAndRecipient() public {
        vm.expectRevert(FeeTooHigh.selector);
        new UniformMakerOps(address(1), address(2), 1, address(0), address(0), feeRecipient, 1_001, 0);

        vm.expectRevert(FeeRecipientRequired.selector);
        new UniformMakerOps(address(1), address(2), 1, address(0), address(0), address(0), 1, 0);
    }
}
