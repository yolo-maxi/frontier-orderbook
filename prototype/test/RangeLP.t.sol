// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {MockERC20} from "../src/MockERC20.sol";
import {RollingFrontierBook} from "../src/RollingFrontierBook.sol";
import {FrontierBookFactory} from "../src/FrontierBookFactory.sol";
import {RangeLP, RangeLPFactory} from "../src/periphery/RangeLP.sol";
import {newFactory} from "./utils/BookFab.sol";

/// @notice Uniswap-style passive LP living on the orderbook: symmetric
/// ladders around mid, fills convert inventory, rebalance re-centers.
contract RangeLPTest is Test {
    MockERC20 internal t0;
    MockERC20 internal t1;
    RollingFrontierBook internal book;
    RangeLP internal vault;

    address internal lp;
    address internal taker;

    uint128 internal constant L = 1e18;

    function setUp() public {
        lp = makeAddr("lp");
        taker = makeAddr("taker");
        t0 = new MockERC20("WETH", "WETH");
        t1 = new MockERC20("USDC", "USDC");
        FrontierBookFactory factory = newFactory(address(0));
        book = RollingFrontierBook(factory.createBook(address(t0), address(t1), 1, 100));

        RangeLPFactory lpf = new RangeLPFactory();
        vm.prank(lp);
        vault = RangeLP(lpf.createVault(book));

        // fund the vault with two-sided inventory
        t0.mint(address(vault), 10 * uint256(L));
        t1.mint(address(vault), 15 * uint256(L));

        t0.mint(taker, 1e30);
        t1.mint(taker, 1e30);
        vm.startPrank(taker);
        t0.approve(address(book), type(uint256).max);
        t1.approve(address(book), type(uint256).max);
        vm.stopPrank();
    }

    function testOpenQuotesBothSides() public {
        vm.prank(lp);
        vault.open(L, 5, 1);
        assertEq(book.activeLiquidity(101), L, "asks above mid");
        assertEq(book.activeLiquidity(105), L, "5 ask levels");
    }

    function testFillsConvertInventoryAndRebalanceRecenters() public {
        vm.prank(lp);
        vault.open(L, 5, 1);

        // market trades up through 3 of the LP's ask levels
        vm.prank(taker);
        book.moveTickTo(104);

        vm.prank(lp);
        vault.rebalance();

        // recentered around the new mid (104): asks from 105, bids from 103
        assertEq(book.activeLiquidity(105), L, "new asks above new mid");
        // sold WETH became USDC inventory: more bid levels affordable now
        assertGt(vault.token1Balance() + 5 * uint256(L), 15 * uint256(L), "inventory rotated toward token1");
    }

    function testCloseReturnsEverythingNoValueStuck() public {
        vm.prank(lp);
        vault.open(L, 5, 1);
        vm.prank(taker);
        book.moveTickTo(103); // partial fills
        vm.prank(lp);
        vault.close();

        assertEq(vault.token0Balance(), 0, "vault drained of token0");
        assertEq(vault.token1Balance(), 0, "vault drained of token1");
        assertEq(book.activeLiquidity(101), 0, "no orders left");
        // LP holds the proceeds: initial value plus spread earned on fills
        assertGt(t1.balanceOf(lp), 0, "fill proceeds reached the LP");
        assertGt(t0.balanceOf(lp), 0, "unfilled inventory returned");
    }

    function testStrangerCannotManage() public {
        vm.prank(lp);
        vault.open(L, 5, 1);
        vm.prank(taker);
        vm.expectRevert(bytes("owner only"));
        vault.rebalance();
    }
}
