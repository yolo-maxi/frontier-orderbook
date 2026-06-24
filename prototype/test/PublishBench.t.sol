// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {MockERC20} from "../src/MockERC20.sol";
import {UniformFrontierBook} from "../src/UniformFrontierBook.sol";
import {newBook} from "./utils/BookFab.sol";

/// @notice Publishable before/after benchmark. Run with --isolate so every
/// number is a real per-transaction cost (intrinsic + cold access +
/// refunds). This file compiles against both the per-level (pre-ozempic)
/// and endpoint-telescoped versions of the book — check out either commit
/// and run the same scenarios.
contract PublishBenchTest is Test {
    MockERC20 internal t0;
    MockERC20 internal t1;
    UniformFrontierBook internal book;

    address internal maker;
    address internal taker;

    uint128 internal constant L = 1e18;

    function setUp() public {
        maker = makeAddr("maker");
        taker = makeAddr("taker");
    }

    function _fresh() internal {
        t0 = new MockERC20("T0", "T0");
        t1 = new MockERC20("T1", "T1");
        book = newBook(address(t0), address(t1), 1, 0, address(0), address(0));
        t0.mint(maker, 1e30);
        vm.prank(maker);
        t0.approve(address(book), type(uint256).max);
        t1.mint(taker, 1e30);
        vm.prank(taker);
        t1.approve(address(book), type(uint256).max);
    }

    /// @dev Dense: ONE maker ladders N contiguous thin levels; the taker
    /// sweeps all of them. This is the headline thin-tick scenario.
    function testBenchDenseOneMaker() public {
        uint24[3] memory ns = [uint24(50), 500, 5000];
        for (uint256 c = 0; c < ns.length; c++) {
            _fresh();
            vm.prank(maker);
            book.deposit(1, 1 + int24(ns[c]), L);
            vm.prank(taker);
            uint256 g = gasleft();
            book.moveTickTo(1 + int24(ns[c]));
            console2.log("dense sweep, 1 maker, levels:", ns[c], g - gasleft());
            assertEq(book.activeLiquidity(1), 0, "really swept");
        }
    }

    /// @dev Dense: FIVE makers, 100 levels each, distinct sizes, contiguous
    /// — every one of 500 thin levels holds active liquidity.
    function testBenchDenseFiveMakers() public {
        _fresh();
        for (uint256 i = 0; i < 5; i++) {
            address m = makeAddr(string(abi.encodePacked("m", vm.toString(i))));
            t0.mint(m, 1e30);
            vm.startPrank(m);
            t0.approve(address(book), type(uint256).max);
            book.deposit(int24(1 + int256(i) * 100), int24(101 + int256(i) * 100), uint128(i + 1) * L);
            vm.stopPrank();
        }
        vm.prank(taker);
        uint256 g = gasleft();
        book.moveTickTo(501);
        console2.log("dense sweep, 5 makers, 500 active levels:", g - gasleft());
    }

    /// @dev Sparse: two single-level orders 100k ticks apart (bitmap walk
    /// dominates; was already solved pre-ozempic).
    function testBenchSparse() public {
        _fresh();
        vm.startPrank(maker);
        book.deposit(10, 11, L);
        book.deposit(100010, 100011, L);
        vm.stopPrank();
        vm.prank(taker);
        uint256 g = gasleft();
        book.moveTickTo(100011);
        console2.log("sparse sweep, 2 orders across 100k-tick gap:", g - gasleft());
    }

    // ------------------------------------------------------------------
    // BID side: identical scenarios mirrored downward
    // ------------------------------------------------------------------

    function _freshAt(int24 tick) internal {
        t0 = new MockERC20("T0", "T0");
        t1 = new MockERC20("T1", "T1");
        book = newBook(address(t0), address(t1), 1, tick, address(0), address(0));
        t1.mint(maker, 1e30);
        vm.prank(maker);
        t1.approve(address(book), type(uint256).max);
        t0.mint(taker, 1e30);
        vm.prank(taker);
        t0.approve(address(book), type(uint256).max);
    }

    /// @dev Dense bid wall: ONE maker, N contiguous thin levels below price;
    /// the taker sells through all of them.
    function testBenchBidDenseOneMaker() public {
        uint24[3] memory ns = [uint24(50), 500, 5000];
        for (uint256 c = 0; c < ns.length; c++) {
            _freshAt(1 + int24(ns[c]));
            vm.prank(maker);
            book.depositBid(1, 1 + int24(ns[c]), L);
            vm.prank(taker);
            uint256 g = gasleft();
            book.moveTickTo(1);
            console2.log("dense bid sweep, 1 maker, levels:", ns[c], g - gasleft());
            assertEq(book.currentTick(), 1, "sweep reached target tick");
        }
    }

    /// @dev Dense bids: FIVE makers, 100 levels each, distinct sizes,
    /// contiguous — every one of 500 thin levels holds an active bid.
    function testBenchBidDenseFiveMakers() public {
        _freshAt(501);
        for (uint256 i = 0; i < 5; i++) {
            address m = makeAddr(string(abi.encodePacked("b", vm.toString(i))));
            t1.mint(m, 1e30);
            vm.startPrank(m);
            t1.approve(address(book), type(uint256).max);
            book.depositBid(int24(1 + int256(i) * 100), int24(101 + int256(i) * 100), uint128(i + 1) * L);
            vm.stopPrank();
        }
        vm.prank(taker);
        uint256 g = gasleft();
        book.moveTickTo(1);
        console2.log("dense bid sweep, 5 makers, 500 active levels:", g - gasleft());
    }

    /// @dev Sparse bids: two single-level bids 100k ticks apart.
    function testBenchBidSparse() public {
        _freshAt(100011);
        vm.startPrank(maker);
        book.depositBid(100010, 100011, L);
        book.depositBid(10, 11, L);
        vm.stopPrank();
        vm.prank(taker);
        uint256 g = gasleft();
        book.moveTickTo(10);
        console2.log("sparse bid sweep, 2 bids across 100k-tick gap:", g - gasleft());
    }
}
