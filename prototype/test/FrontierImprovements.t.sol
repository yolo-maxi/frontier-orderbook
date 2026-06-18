// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {MockERC20} from "../src/MockERC20.sol";
import {GeometricFrontierBook} from "../src/GeometricFrontierBook.sol";
import {UniformFrontierBook} from "../src/UniformFrontierBook.sol";
import {FrontierBookBase} from "../src/FrontierBookBase.sol";
import {FrontierLens} from "../src/periphery/FrontierLens.sol";
import {newBook, newGeoBook} from "./utils/BookFab.sol";

/// @notice Covers the deploy-ready improvements:
///  - on-chain frontier exposure (frontierOf / bidFrontierOf)
///  - keeper-friendly claimAuto / claimBidAuto with min-proceeds guard
///  - enriched FrontierLens reads (positionView / positionViews / positionsOf)
contract FrontierImprovementsTest is Test {
    MockERC20 internal t0;
    MockERC20 internal t1;
    UniformFrontierBook internal book;
    FrontierLens internal lens;

    address internal mm = makeAddr("mm");
    address internal taker = makeAddr("taker");
    address internal keeper = makeAddr("keeper");

    uint128 internal constant L = 1e18;

    function setUp() public {
        t0 = new MockERC20("T0", "T0");
        t1 = new MockERC20("T1", "T1");
        // start at tick 50 so we have room for both asks (above) and bids (below)
        book = newBook(address(t0), address(t1), 1, 50, address(0), address(0));
        lens = new FrontierLens();

        t0.mint(mm, 1e30);
        t1.mint(mm, 1e30);
        t1.mint(taker, 1e30);
        t0.mint(taker, 1e30);
        vm.startPrank(mm);
        t0.approve(address(book), type(uint256).max);
        t1.approve(address(book), type(uint256).max);
        vm.stopPrank();
        vm.startPrank(taker);
        t0.approve(address(book), type(uint256).max);
        t1.approve(address(book), type(uint256).max);
        vm.stopPrank();
    }

    // ------------------------------------------------------------------
    // C1: frontierOf / bidFrontierOf
    // ------------------------------------------------------------------

    function testFrontierOfTracksUpSweep() public {
        vm.prank(mm);
        uint256 id = book.deposit(60, 70, L); // 10 levels of asks

        // unfilled: frontier sits at the lower boundary (claimedUpper)
        assertEq(book.frontierOf(id), 60, "unfilled frontier == lower");

        vm.prank(taker);
        book.moveTickTo(65); // fills levels [60,65)
        assertEq(book.frontierOf(id), 65, "frontier follows sweep");

        vm.prank(taker);
        book.moveTickTo(70); // fills the rest
        assertEq(book.frontierOf(id), 70, "frontier clamps to upper");
    }

    function testBidFrontierOfTracksDownSweep() public {
        vm.prank(mm);
        uint256 id = book.depositBid(30, 40, L); // 10 levels of bids below price

        assertEq(book.bidFrontierOf(id), 40, "unfilled bid frontier == upper");

        vm.prank(taker);
        book.moveTickTo(35); // sells into bids [35,40)
        assertEq(book.bidFrontierOf(id), 35, "bid frontier follows down-sweep");
    }

    function testFrontierOfRevertsOnWrongSide() public {
        vm.prank(mm);
        uint256 ask = book.deposit(60, 70, L);
        vm.prank(mm);
        uint256 bid = book.depositBid(30, 40, L);

        vm.expectRevert(bytes("not a live ask"));
        book.frontierOf(bid);
        vm.expectRevert(bytes("not a live bid"));
        book.bidFrontierOf(ask);
    }

    // ------------------------------------------------------------------
    // C1: claimAuto / claimBidAuto
    // ------------------------------------------------------------------

    function testClaimAutoPaysOwnerAndHonorsMin() public {
        vm.prank(mm);
        uint256 id = book.deposit(60, 70, L);
        vm.prank(taker);
        book.moveTickTo(70); // fully filled

        uint256 expected = book.claimable(id);
        assertGt(expected, 0, "has proceeds");

        // anyone can trigger; proceeds go to the owner
        uint256 before = t1.balanceOf(mm);
        vm.prank(mm);
        uint256 got = book.claimAuto(id, expected); // exact min == proceeds OK
        assertEq(got, expected, "claimAuto pays the frontier span");
        assertEq(t1.balanceOf(mm) - before, expected, "owner received proceeds");
    }

    function testClaimAutoRevertsBelowMin() public {
        vm.prank(mm);
        uint256 id = book.deposit(60, 70, L);
        vm.prank(taker);
        book.moveTickTo(70);

        uint256 expected = book.claimable(id);
        vm.prank(mm);
        vm.expectRevert(bytes("below min proceeds"));
        book.claimAuto(id, expected + 1);
    }

    function testClaimAutoRevertsNothingToClaim() public {
        vm.prank(mm);
        uint256 id = book.deposit(60, 70, L);
        vm.prank(mm);
        vm.expectRevert(bytes("nothing to claim"));
        book.claimAuto(id, 0);
    }

    function testClaimBidAutoPaysOwner() public {
        vm.prank(mm);
        uint256 id = book.depositBid(30, 40, L);
        vm.prank(taker);
        book.moveTickTo(30); // fully fills the bid

        uint256 expected = book.bidClaimable(id);
        assertGt(expected, 0, "has token0 proceeds");
        uint256 before = t0.balanceOf(mm);
        vm.prank(mm);
        uint256 got = book.claimBidAuto(id, expected);
        assertEq(got, expected, "claimBidAuto pays the frontier span");
        assertEq(t0.balanceOf(mm) - before, expected, "owner received token0");
    }

    // ------------------------------------------------------------------
    // Periphery: enriched lens reads
    // ------------------------------------------------------------------

    function testPositionViewAskMatchesGetters() public {
        vm.prank(mm);
        uint256 id = book.deposit(60, 70, L);
        vm.prank(taker);
        book.moveTickTo(65);

        FrontierLens.PositionView memory v = lens.positionView(book, id);
        assertEq(v.positionId, id);
        assertEq(v.owner, mm, "owner");
        assertEq(v.lower, 60);
        assertEq(v.upper, 70);
        assertTrue(v.live, "live");
        assertFalse(v.isBid, "ask");
        assertEq(v.frontier, book.frontierOf(id), "frontier matches book");
        assertEq(v.claimable, book.claimable(id), "claimable matches book");
        assertEq(v.unfilled, book.unfilledPrincipal(id), "unfilled matches book");
    }

    function testPositionViewBidMatchesGetters() public {
        vm.prank(mm);
        uint256 id = book.depositBid(30, 40, L);
        vm.prank(taker);
        book.moveTickTo(35);

        FrontierLens.PositionView memory v = lens.positionView(book, id);
        assertTrue(v.isBid, "bid");
        assertEq(v.frontier, book.bidFrontierOf(id), "bid frontier matches");
        assertEq(v.claimable, book.bidClaimable(id), "bid claimable matches");
        assertEq(v.unfilled, book.bidRefundable(id), "bid refundable matches");
    }

    function testPositionViewDeadIdIsZeroed() public view {
        FrontierLens.PositionView memory v = lens.positionView(book, 9999);
        assertFalse(v.live, "dead id not live");
        assertEq(v.owner, address(0), "no owner");
    }

    function testPositionsOfFiltersByOwner() public {
        vm.startPrank(mm);
        uint256 a = book.deposit(60, 70, L);
        uint256 b = book.depositBid(30, 40, L);
        vm.stopPrank();

        // a position owned by someone else
        t0.mint(taker, 1e30);
        vm.prank(taker);
        uint256 c = book.deposit(80, 90, L);

        FrontierLens.PositionView[] memory mine = lens.positionsOf(book, mm, 0, 0);
        assertEq(mine.length, 2, "mm owns two live positions");
        // order preserved by id
        assertEq(mine[0].positionId, a);
        assertEq(mine[1].positionId, b);

        FrontierLens.PositionView[] memory theirs = lens.positionsOf(book, taker, 0, 0);
        assertEq(theirs.length, 1, "taker owns one");
        assertEq(theirs[0].positionId, c);
    }

    function testPositionViewsBatch() public {
        vm.startPrank(mm);
        uint256 a = book.deposit(60, 70, L);
        uint256 b = book.depositBid(30, 40, L);
        vm.stopPrank();

        uint256[] memory ids = new uint256[](3);
        ids[0] = a;
        ids[1] = b;
        ids[2] = 9999; // dead
        FrontierLens.PositionView[] memory vs = lens.positionViews(book, ids);
        assertEq(vs.length, 3);
        assertTrue(vs[0].live);
        assertTrue(vs[1].live);
        assertFalse(vs[2].live);
    }

    // geometric (production curve) sanity: frontierOf works there too
    function testGeoFrontierOf() public {
        GeometricFrontierBook geo = newGeoBook(address(t0), address(t1), 1, 50, address(0), address(0));
        t0.mint(mm, 1e30);
        vm.startPrank(mm);
        t0.approve(address(geo), type(uint256).max);
        uint256 id = geo.deposit(60, 70, L);
        vm.stopPrank();
        assertEq(geo.frontierOf(id), 60);

        t1.mint(taker, 1e30);
        vm.startPrank(taker);
        t1.approve(address(geo), type(uint256).max);
        geo.moveTickTo(64);
        vm.stopPrank();
        assertEq(geo.frontierOf(id), 64, "geo frontier tracks sweep");
    }
}
