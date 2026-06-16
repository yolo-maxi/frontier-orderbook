// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {MockERC20} from "../src/MockERC20.sol";
import {GeometricFrontierBook} from "../src/GeometricFrontierBook.sol";
import {UniformFrontierBook} from "../src/UniformFrontierBook.sol";
import {FrontierBookBase} from "../src/FrontierBookBase.sol";
import {FrontierGeoBookFactory} from "../src/FrontierGeoBookFactory.sol";
import {FrontierRouter} from "../src/periphery/FrontierRouter.sol";
import {FrontierLens} from "../src/periphery/FrontierLens.sol";
import {newBook, newFactory} from "./utils/BookFab.sol";

/// @notice Periphery: aggregator-shaped router (v2-style path swaps with
/// exact-in semantics + refunds) and the lens (depth + to-the-wei quotes),
/// driven against the production geometric book.
contract PeripheryTest is Test {
    MockERC20 internal t0;
    MockERC20 internal t1;
    FrontierGeoBookFactory internal factory;
    FrontierRouter internal router;
    FrontierLens internal lens;
    GeometricFrontierBook internal book;

    address internal mm;
    address internal trader;

    uint128 internal constant L = 1e18;

    function setUp() public {
        mm = makeAddr("mm");
        trader = makeAddr("trader");
        t0 = new MockERC20("WETH", "WETH");
        t1 = new MockERC20("USDC", "USDC");
        factory = newFactory(address(0));
        lens = new FrontierLens();
        router = new FrontierRouter(address(factory), lens);
        book = GeometricFrontierBook(factory.createGeoBook(address(t0), address(t1), 1, 100));

        t0.mint(mm, 1e30);
        t1.mint(mm, 1e30);
        vm.startPrank(mm);
        t0.approve(address(book), type(uint256).max);
        t1.approve(address(book), type(uint256).max);
        // a two-sided market: asks above 100, bids below
        book.deposit(101, 111, L);
        book.depositBid(90, 100, L);
        vm.stopPrank();

        t0.mint(trader, 1e30);
        t1.mint(trader, 1e30);
        vm.startPrank(trader);
        t0.approve(address(router), type(uint256).max);
        t1.approve(address(router), type(uint256).max);
        vm.stopPrank();
    }

    function testV2StyleBuyMatchesLensQuote() public {
        uint256 amountIn = 3 * uint256(L); // roughly buys ~2.7 levels
        (uint256 q0, uint256 q1,) = lens.quoteBuy(book, amountIn);

        address[] memory path = new address[](2);
        path[0] = address(t1); // token1 in
        path[1] = address(t0); // token0 out
        uint256 bal0 = t0.balanceOf(trader);
        uint256 bal1 = t1.balanceOf(trader);

        vm.prank(trader);
        uint256[] memory amounts =
            router.swapExactTokensForTokens(amountIn, q0, path, trader, block.timestamp);

        assertEq(amounts[1], q0, "execution == lens quote (token0 out)");
        assertEq(amounts[0], q1, "spent == lens quote (token1 in)");
        assertEq(t0.balanceOf(trader) - bal0, q0, "received real token0");
        assertEq(bal1 - t1.balanceOf(trader), q1, "only the spent amount left the wallet (refund works)");
    }

    function testV2StyleSellMatchesLensQuote() public {
        uint256 amountIn = 4 * uint256(L);
        (uint256 q1, uint256 q0,) = lens.quoteSell(book, amountIn, 100);

        address[] memory path = new address[](2);
        path[0] = address(t0);
        path[1] = address(t1);
        vm.prank(trader);
        uint256[] memory amounts =
            router.swapExactTokensForTokens(amountIn, q1, path, trader, block.timestamp);

        assertEq(amounts[0], q0, "token0 spent == quote");
        assertEq(amounts[1], q1, "token1 out == quote");
    }

    function testMinOutProtects() public {
        address[] memory path = new address[](2);
        path[0] = address(t1);
        path[1] = address(t0);
        vm.prank(trader);
        vm.expectRevert(bytes("insufficient output"));
        router.swapExactTokensForTokens(uint256(L), 100 * uint256(L), path, trader, block.timestamp);
    }

    function testLensDepthAndSummary() public {
        FrontierLens.BookSummary memory s = lens.summary(book, 50);
        assertEq(s.currentTick, 100);
        assertEq(s.bestAsk, 101, "best ask found");
        assertEq(s.bestBid, 99, "best bid found");

        FrontierLens.Level[] memory levels = lens.depth(book, 90, 111, 64);
        uint256 asks;
        uint256 bids;
        for (uint256 i = 0; i < levels.length; i++) {
            if (levels[i].askSize > 0) asks++;
            if (levels[i].bidSize > 0) bids++;
        }
        assertEq(asks, 10, "10 ask levels visible");
        assertEq(bids, 10, "10 bid levels visible");
    }
}

import {FrontierMakerKit} from "../src/periphery/FrontierMakerKit.sol";

contract MakerKitTest is Test {
    MockERC20 internal t0;
    MockERC20 internal t1;
    UniformFrontierBook internal book;
    FrontierMakerKit internal kit;
    address internal mm;

    function setUp() public {
        mm = makeAddr("mm");
        t0 = new MockERC20("WETH", "WETH");
        t1 = new MockERC20("USDC", "USDC");
        book = newBook(address(t0), address(t1), 1, 100, address(0), address(0));
        kit = new FrontierMakerKit();
        t0.mint(mm, 1e30);
        t1.mint(mm, 1e30);
        vm.startPrank(mm);
        t0.approve(address(kit), type(uint256).max);
        t1.approve(address(kit), type(uint256).max);
        vm.stopPrank();
    }

    function testPlaceWholeCurveInOneTx() public {
        // a 3-segment quoting curve out of uniform ladders: near asks, far
        // asks, bids
        FrontierMakerKit.Segment[] memory segs = new FrontierMakerKit.Segment[](3);
        segs[0] = FrontierMakerKit.Segment(101, 111, 10e18, false); // near asks
        segs[1] = FrontierMakerKit.Segment(111, 121, 1e18, false); // flat tail
        segs[2] = FrontierMakerKit.Segment(90, 100, 2e18, true); // bids

        vm.prank(mm);
        uint256[] memory ids = kit.placeCurve(book, segs);

        assertEq(book.activeLiquidity(101), 10e18, "near segment live");
        assertEq(book.activeLiquidity(111), 1e18, "flat segment live");
        assertEq(book.bidLiquidity(95), 2e18, "bid segment live");
        // positions belong to the CALLER, not the kit
        for (uint256 i = 0; i < 3; i++) {
            (address owner,,,,,,,) = book.positions(ids[i]);
            assertEq(owner, mm, "caller owns the position");
        }
        // and the caller can manage them directly
        vm.prank(mm);
        book.cancel(ids[1]);
        assertEq(book.activeLiquidity(111), 0, "caller cancelled their own segment");
    }

    function testTransferPosition() public {
        address alice = makeAddr("alice");
        vm.startPrank(mm);
        t0.approve(address(book), type(uint256).max);
        uint256 id = book.deposit(101, 103, 1e18);
        book.transferPosition(id, alice);
        vm.expectRevert(bytes("not owner"));
        book.cancel(id); // old owner locked out
        vm.stopPrank();
        vm.prank(alice);
        book.cancel(id); // new owner controls (and receives funds)
        assertGt(t0.balanceOf(alice), 0, "principal followed ownership");
    }
}

/// @notice Same periphery, exercising the lens's curve detection and the
/// production telescoped rounding end to end.
contract GeoPeripheryTest is Test {
    MockERC20 internal t0;
    MockERC20 internal t1;
    FrontierRouter internal router;
    FrontierLens internal lens;
    GeometricFrontierBook internal book;

    address internal mm;
    address internal trader;

    uint128 internal constant L = 1e18;

    function setUp() public {
        mm = makeAddr("mm");
        trader = makeAddr("trader");
        t0 = new MockERC20("WETH", "WETH");
        t1 = new MockERC20("USDC", "USDC");
        FrontierGeoBookFactory factory = newFactory(address(0));
        lens = new FrontierLens();
        router = new FrontierRouter(address(factory), lens);
        book = GeometricFrontierBook(factory.createGeoBook(address(t0), address(t1), 1, 100));

        t0.mint(mm, 1e30);
        t1.mint(mm, 1e30);
        vm.startPrank(mm);
        t0.approve(address(book), type(uint256).max);
        t1.approve(address(book), type(uint256).max);
        book.deposit(101, 111, L);
        book.depositBid(90, 100, L);
        vm.stopPrank();

        t0.mint(trader, 1e30);
        t1.mint(trader, 1e30);
        vm.startPrank(trader);
        t0.approve(address(router), type(uint256).max);
        t1.approve(address(router), type(uint256).max);
        vm.stopPrank();
    }

    function testGeoCurveDetected() public {
        FrontierLens.Curve memory c = lens.curveOf(book);
        assertTrue(c.geo, "geometric book detected");
        assertEq(c.d, book.geoD(), "denominator read");
        FrontierLens.Curve memory lin =
            lens.curveOf(FrontierBookBase(address(new FrontierLens()))); // any non-book: no geoD
        assertTrue(!lin.geo, "non-geo contract is linear-classed");
    }

    function testGeoBuyMatchesLensQuote() public {
        // 3.7 * L: lands mid-run, forcing the budget subdivision + ceil path
        uint256 amountIn = 37 * uint256(L) / 10;
        (uint256 q0, uint256 q1,) = lens.quoteBuy(book, amountIn);
        assertGt(q0, 0, "quote fills something");

        address[] memory path = new address[](2);
        path[0] = address(t1);
        path[1] = address(t0);
        vm.prank(trader);
        uint256[] memory amounts = router.swapExactTokensForTokens(amountIn, q0, path, trader, block.timestamp);

        assertEq(amounts[1], q0, "execution == lens quote (token0 out)");
        assertEq(amounts[0], q1, "spent == lens quote (token1 in)");
    }

    function testGeoBuyExhaustsBookWithRefund() public {
        uint256 amountIn = 20 * uint256(L); // all 10 asks cost ~10.6 L
        (uint256 q0, uint256 q1,) = lens.quoteBuy(book, amountIn);
        assertEq(q0, 10 * uint256(L), "all asks consumed");
        assertLt(q1, amountIn, "partial spend quoted");

        uint256 bal1 = t1.balanceOf(trader);
        vm.prank(trader);
        (uint256 paid, uint256 received) =
            router.buyExactIn(book, amountIn, q0, trader, block.timestamp);
        assertEq(received, q0, "received == quote");
        assertEq(paid, q1, "paid == quote");
        assertEq(bal1 - t1.balanceOf(trader), q1, "unspent refunded");
    }

    function testGeoSellMatchesLensQuote() public {
        // 4.5 * L: partial bid run, exercising the one-division subdivision
        uint256 amountIn = 45 * uint256(L) / 10;
        (uint256 q1, uint256 q0,) = lens.quoteSell(book, amountIn, 100);
        assertGt(q1, 0, "quote fills something");

        address[] memory path = new address[](2);
        path[0] = address(t0);
        path[1] = address(t1);
        vm.prank(trader);
        uint256[] memory amounts = router.swapExactTokensForTokens(amountIn, q1, path, trader, block.timestamp);

        assertEq(amounts[0], q0, "token0 spent == quote");
        assertEq(amounts[1], q1, "token1 out == quote");
    }

    function testGeoGetAmountsOut() public {
        uint256 amountIn = 2 * uint256(L);
        address[] memory path = new address[](2);
        path[0] = address(t1);
        path[1] = address(t0);
        uint256[] memory quoted = router.getAmountsOut(amountIn, path);

        vm.prank(trader);
        uint256[] memory amounts = router.swapExactTokensForTokens(amountIn, quoted[1], path, trader, block.timestamp);
        assertEq(amounts[0], quoted[0], "getAmountsOut spent matches");
        assertEq(amounts[1], quoted[1], "getAmountsOut received matches");
    }
}
