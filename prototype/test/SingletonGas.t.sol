// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {FrontierMakerOps} from "../src/FrontierMakerOps.sol";
import {FrontierVault} from "../src/FrontierVault.sol";
import {MockERC20} from "../src/MockERC20.sol";
import {RollingFrontierBook} from "../src/RollingFrontierBook.sol";
import {SingletonFrontierBook} from "../src/SingletonFrontierBook.sol";
import {newBook} from "./utils/BookFab.sol";

contract SingletonGasTest is Test {
    MockERC20 internal t0;
    MockERC20 internal t1;
    RollingFrontierBook internal book;
    SingletonFrontierBook internal singleton;
    FrontierVault internal vault;

    address internal mm = makeAddr("mm");
    address internal taker = makeAddr("taker");

    uint128 internal constant L = 1e18;

    function testBidDepositFundingPathGas() public {
        _freshBook(100);
        vm.prank(mm);
        uint256 g = gasleft();
        book.depositBid(50, 60, L);
        uint256 walletFunded = g - gasleft();
        console2.log("current wallet-funded bid deposit (10 levels):", walletFunded);

        _freshBook(100);
        vm.prank(mm);
        uint256 ask = book.deposit(101, 111, L);
        vm.prank(taker);
        book.moveTickTo(111);
        vm.prank(mm);
        book.claimInternal(ask);
        vm.prank(mm);
        t1.approve(address(book), 0);
        vm.prank(mm);
        g = gasleft();
        book.depositBid(101, 111, L);
        uint256 perBookCredit = g - gasleft();
        console2.log("per-book internal-credit bid deposit (10 levels):", perBookCredit);

        _freshSingleton(100);
        uint256 bidCost = _spanValue(50, 60, true);
        vm.prank(mm);
        vault.deposit(address(t1), bidCost);
        vm.prank(mm);
        g = gasleft();
        singleton.depositBid(50, 60, L);
        uint256 singletonCredit = g - gasleft();
        console2.log("singleton-credit bid deposit (10 levels):", singletonCredit);

        assertEq(vault.balanceOf(mm, address(t1)), 0, "spent singleton credit");
        assertEq(t1.balanceOf(address(singleton)), 0, "singleton book skipped token custody");
    }

    function _freshBook(int24 startTick) internal {
        t0 = new MockERC20("T0", "T0");
        t1 = new MockERC20("T1", "T1");
        book = newBook(address(t0), address(t1), 1, startTick, address(0), address(0));
        _fundAndApprove(address(book));
    }

    function _freshSingleton(int24 startTick) internal {
        t0 = new MockERC20("T0", "T0");
        t1 = new MockERC20("T1", "T1");
        vault = new FrontierVault(address(this));
        FrontierMakerOps ops = new FrontierMakerOps(address(t0), address(t1), 1, address(0), address(0));
        singleton = new SingletonFrontierBook(
            address(t0), address(t1), 1, startTick, address(0), address(0), address(ops), address(vault)
        );
        vault.setBookAuthorization(address(singleton), true);
        _fundAndApprove(address(singleton));
        vm.startPrank(mm);
        t0.approve(address(vault), type(uint256).max);
        t1.approve(address(vault), type(uint256).max);
        vm.stopPrank();
    }

    function _fundAndApprove(address spender) internal {
        t0.mint(mm, 1e30);
        t1.mint(mm, 1e30);
        vm.startPrank(mm);
        t0.approve(spender, type(uint256).max);
        t1.approve(spender, type(uint256).max);
        vm.stopPrank();

        t0.mint(taker, 1e30);
        t1.mint(taker, 1e30);
        vm.startPrank(taker);
        t0.approve(spender, type(uint256).max);
        t1.approve(spender, type(uint256).max);
        vm.stopPrank();
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
