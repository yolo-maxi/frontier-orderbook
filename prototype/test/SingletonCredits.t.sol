// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {FrontierMakerOps} from "../src/FrontierMakerOps.sol";
import {FrontierVault} from "../src/FrontierVault.sol";
import {MockERC20} from "../src/MockERC20.sol";
import {SingletonFrontierBook} from "../src/SingletonFrontierBook.sol";

contract SingletonCreditsTest is Test {
    MockERC20 internal t0;
    MockERC20 internal t1;
    FrontierVault internal vault;
    SingletonFrontierBook internal book;

    address internal maker = makeAddr("maker");
    address internal taker = makeAddr("taker");

    uint128 internal constant L = 1e18;

    function setUp() public {
        _fresh(100);
    }

    function _fresh(int24 startTick) internal {
        t0 = new MockERC20("T0", "T0");
        t1 = new MockERC20("T1", "T1");
        vault = new FrontierVault(address(this));
        FrontierMakerOps ops = new FrontierMakerOps(address(t0), address(t1), 1, address(0), address(0));
        book = new SingletonFrontierBook(
            address(t0), address(t1), 1, startTick, address(0), address(0), address(ops), address(vault)
        );
        vault.setBookAuthorization(address(book), true);

        t0.mint(maker, 1e30);
        t1.mint(maker, 1e30);
        vm.startPrank(maker);
        t0.approve(address(vault), type(uint256).max);
        t1.approve(address(vault), type(uint256).max);
        vm.stopPrank();

        t0.mint(taker, 1e30);
        t1.mint(taker, 1e30);
        vm.startPrank(taker);
        t0.approve(address(book), type(uint256).max);
        t1.approve(address(book), type(uint256).max);
        vm.stopPrank();
    }

    function testBidDepositFillClaimCancelAndWithdrawUseGlobalCredits() public {
        uint256 bidCost = _spanValue(50, 60, true);
        uint256 expectedRefund = _spanValue(50, 55, false);

        vm.prank(maker);
        vault.deposit(address(t1), bidCost);

        vm.prank(maker);
        uint256 id = book.depositBid(50, 60, L);

        assertEq(vault.balanceOf(maker, address(t1)), 0, "bid consumed liquid token1 credit");
        assertEq(t1.balanceOf(address(vault)), bidCost, "vault holds deployed bid funds");
        assertEq(t1.balanceOf(address(book)), 0, "book never custodies token1");

        uint256 taker1Before = t1.balanceOf(taker);
        vm.prank(taker);
        book.moveTickTo(55);
        assertGt(t1.balanceOf(taker) - taker1Before, 0, "taker received token1 from vault");
        assertEq(t0.balanceOf(address(book)), 0, "book never custodies token0");

        uint256 maker0Before = t0.balanceOf(maker);
        vm.prank(maker);
        uint256 proceeds0 = book.claimBidTo(id, 55);
        assertEq(proceeds0, 5 * uint256(L), "claimed filled bid token0");
        assertEq(vault.balanceOf(maker, address(t0)), proceeds0, "claim credited vault");
        assertEq(t0.balanceOf(maker), maker0Before, "claim did not transfer wallet token0");

        vm.prank(maker);
        (uint256 alreadyClaimed0, uint256 refund1) = book.cancelBidWithWitness(id, 55);
        assertEq(alreadyClaimed0, 0, "already claimed");
        assertEq(refund1, expectedRefund, "cancel credited unfilled bid refund");
        assertEq(vault.balanceOf(maker, address(t1)), expectedRefund);
        assertTrue(vault.solvent(address(t0)));
        assertTrue(vault.solvent(address(t1)));

        vm.startPrank(maker);
        vault.withdraw(address(t0), proceeds0);
        vault.withdraw(address(t1), refund1);
        vm.stopPrank();

        assertEq(t0.balanceOf(address(vault)), 0, "all token0 withdrawn");
        assertEq(t1.balanceOf(address(vault)), 0, "all token1 withdrawn");
        assertEq(vault.totalCredits(address(t0)), 0);
        assertEq(vault.totalCredits(address(t1)), 0);
    }

    function testAskDepositFillClaimCancelAndWithdrawUseGlobalCredits() public {
        _fresh(100);
        uint256 principal0 = 10 * uint256(L);
        uint256 expectedProceeds1 = _spanValue(101, 106, false);

        vm.prank(maker);
        vault.deposit(address(t0), principal0);

        vm.prank(maker);
        uint256 id = book.deposit(101, 111, L);
        assertEq(vault.balanceOf(maker, address(t0)), 0, "ask consumed liquid token0 credit");
        assertEq(t0.balanceOf(address(vault)), principal0, "vault holds deployed ask funds");
        assertEq(t0.balanceOf(address(book)), 0, "book never custodies token0");

        vm.prank(taker);
        book.moveTickTo(106);

        uint256 maker1Before = t1.balanceOf(maker);
        vm.prank(maker);
        uint256 proceeds1 = book.claimTo(id, 106);
        assertEq(proceeds1, expectedProceeds1);
        assertEq(vault.balanceOf(maker, address(t1)), proceeds1, "claim credited vault");
        assertEq(t1.balanceOf(maker), maker1Before, "claim did not transfer wallet token1");

        vm.prank(maker);
        (uint256 alreadyClaimed1, uint256 refund0) = book.cancelWithWitness(id, 106);
        assertEq(alreadyClaimed1, 0, "already claimed");
        assertEq(refund0, 5 * uint256(L), "cancel credited ask tail principal");
        assertEq(vault.balanceOf(maker, address(t0)), refund0);
        assertTrue(vault.solvent(address(t0)));
        assertTrue(vault.solvent(address(t1)));

        vm.startPrank(maker);
        vault.withdraw(address(t1), proceeds1);
        vault.withdraw(address(t0), refund0);
        vm.stopPrank();

        assertEq(t0.balanceOf(address(vault)), 0, "all token0 withdrawn");
        assertEq(t1.balanceOf(address(vault)), 0, "all token1 withdrawn");
    }

    function testUnauthorizedBookCannotConsumeVaultCredit() public {
        FrontierMakerOps ops = new FrontierMakerOps(address(t0), address(t1), 1, address(0), address(0));
        SingletonFrontierBook rogue = new SingletonFrontierBook(
            address(t0), address(t1), 1, 100, address(0), address(0), address(ops), address(vault)
        );

        uint256 bidCost = _spanValue(50, 60, true);
        vm.prank(maker);
        vault.deposit(address(t1), bidCost);

        vm.prank(maker);
        vm.expectRevert(bytes("not book"));
        rogue.depositBid(50, 60, L);
    }

    function _rate(int24 tick) internal pure returns (uint256) {
        return uint256(int256(1e18) + int256(tick) * 1e15);
    }

    function _spanValue(int24 lower, int24 upper, bool roundUp) internal pure returns (uint256 total) {
        for (int24 tick = lower; tick < upper; tick++) {
            uint256 value = uint256(L) * _rate(tick);
            total += roundUp ? (value + 1e18 - 1) / 1e18 : value / 1e18;
        }
    }
}
