// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {MockERC20} from "../src/MockERC20.sol";
import {RollingFrontierBook} from "../src/RollingFrontierBook.sol";
import {GeometricFrontierBook} from "../src/GeometricFrontierBook.sol";
import {GeoTickMath} from "../src/curve/GeoTickMath.sol";
import {FrontierBookFactory} from "../src/FrontierBookFactory.sol";
import {newBook, newFactory} from "./utils/BookFab.sol";

/// @notice Standalone-venue properties: sparse-gap sweeps (tick bitmap),
/// bounded/resumable sweeps, pointer policy (retreat bundling defeats
/// pinning), and ephemeral parallel markets via the factory.
contract FrontierVenueTest is Test {
    MockERC20 internal t0;
    MockERC20 internal t1;
    RollingFrontierBook internal book;

    address internal bob;
    address internal taker;

    uint128 internal constant L = 1e18;

    function setUp() public {
        bob = makeAddr("bob");
        taker = makeAddr("taker");
        _fresh(0);
    }

    function _fresh(int24 startTick) internal {
        t0 = new MockERC20("T0", "T0");
        t1 = new MockERC20("T1", "T1");
        book = newBook(address(t0), address(t1), 1, startTick, address(0), address(0));
        t0.mint(bob, 1e30);
        vm.prank(bob);
        t0.approve(address(book), type(uint256).max);
        t1.mint(taker, 1e30);
        vm.prank(taker);
        t1.approve(address(book), type(uint256).max);
        t1.mint(address(this), 1e30);
        t1.approve(address(book), type(uint256).max);
    }

    function amt1(int24 t, uint256 liq) internal pure returns (uint256) {
        return (liq * uint256(int256(1e18) + int256(t) * 1e15)) / 1e18;
    }

    // ------------------------------------------------------------------
    // Sparse books: sweeps must not pay per empty interval
    // ------------------------------------------------------------------

    function testSparseSweepSkipsEmptyGaps() public {
        // two asks 100k ticks apart — pre-bitmap this sweep was ~210M gas
        vm.startPrank(bob);
        uint256 nearId = book.deposit(10, 11, L);
        uint256 farId = book.deposit(100010, 100011, L);
        vm.stopPrank();

        vm.prank(taker);
        uint256 g = gasleft();
        book.moveTickTo(100011);
        uint256 used = g - gasleft();
        console2.log("sweep gas across 100k-tick gap, 2 fills:", used);

        assertLt(used, 2_000_000, "gap traversal must be word-bounded, not tick-bounded");
        assertEq(book.claimable(nearId), amt1(10, L), "near ask filled");
        assertEq(book.claimable(farId), amt1(100010, L), "far ask filled");
        assertEq(book.currentTick(), 100011, "pointer at target");
    }

    function testSparseSweepGasScalesWithWordsNotTicks() public {
        uint24[2] memory gaps = [uint24(2560), 256000]; // 10 words vs 1000 words
        uint256[2] memory gasUsed;
        for (uint256 c = 0; c < gaps.length; c++) {
            _fresh(0);
            vm.prank(bob);
            book.deposit(int24(gaps[c]), int24(gaps[c]) + 1, L);
            vm.prank(taker);
            uint256 g = gasleft();
            book.moveTickTo(int24(gaps[c]) + 1);
            gasUsed[c] = g - gasleft();
            console2.log("sweep gas over gap:", gaps[c], gasUsed[c]);
        }
        // 100x the ticks should be ~100x the WORD reads, far below 100x total
        assertLt(gasUsed[1], gasUsed[0] * 25, "scaling must be per-word, not per-tick");
    }

    // ------------------------------------------------------------------
    // Bounded, resumable sweeps
    // ------------------------------------------------------------------

    function testResumableSweep() public {
        // sweep budgets count ENDPOINTS (runs), not levels: use stacked
        // DISTINCT-size orders so each junction is a real endpoint
        // (equal sizes would net the shared boundary to zero and merge runs)
        uint256[4] memory ids;
        for (uint256 i = 0; i < 4; i++) {
            vm.prank(bob);
            ids[i] = book.deposit(int24(10 + int256(i)), int24(11 + int256(i)), uint128((i + 1)) * L);
        }

        vm.prank(taker);
        int24 reached = book.sweep(14, 2); // budget: 2 endpoint-steps
        assertEq(reached, 12, "parked at first unconsumed endpoint");
        assertEq(book.currentTick(), 12, "pointer parked");
        assertEq(book.claimable(ids[0]), amt1(10, L), "first order paid");
        assertEq(book.claimable(ids[1]), amt1(11, 2 * L), "second order paid");
        assertEq(book.claimable(ids[2]), 0, "third order untouched");
        assertEq(book.activeLiquidity(12), 3 * L, "third order still resting");

        vm.prank(taker);
        reached = book.sweep(14, type(uint256).max); // resume
        assertEq(reached, 14, "completed");
        assertEq(book.claimable(ids[2]), amt1(12, 3 * L), "third paid after resume");
        assertEq(book.claimable(ids[3]), amt1(13, 4 * L), "fourth paid after resume");
        assertEq(book.unfilledPrincipal(ids[3]), 0, "fully consumed");
    }

    function testZeroBudgetSweepMovesNothing() public {
        vm.prank(bob);
        book.deposit(10, 12, L);
        vm.prank(taker);
        int24 reached = book.sweep(12, 0);
        assertEq(reached, 10, "parks below first liquidity");
        assertEq(book.activeLiquidity(10), L, "nothing filled");
    }

    // ------------------------------------------------------------------
    // Pointer policy: pinning is defeated by bundling a retreat
    // ------------------------------------------------------------------

    function testPointerPinDefeatedByBundledRetreat() public {
        // attacker pins the pointer high through empty space (free)
        address attacker = makeAddr("attacker");
        vm.prank(attacker);
        book.moveTickTo(500000);

        // naive deposit is blocked...
        vm.prank(bob);
        vm.expectRevert(bytes("range not above price"));
        book.deposit(1, 100, L);

        // ...but retreats are free, permissionless, and harmless to others,
        // so the depositor bundles one atomically with the deposit
        vm.startPrank(bob);
        book.moveTickTo(0);
        uint256 id = book.deposit(1, 100, L);
        vm.stopPrank();

        // and the book works normally afterwards
        vm.prank(taker);
        book.moveTickTo(2);
        assertEq(book.claimable(id), amt1(1, L), "filled despite pin attempt");
    }

    function testRetreatChangesNoEntitlements() public {
        vm.prank(bob);
        uint256 id = book.deposit(1, 100, L);
        vm.prank(taker);
        book.moveTickTo(3);

        uint256 claimableBefore = book.claimable(id);
        uint256 principalBefore = book.unfilledPrincipal(id);

        book.moveTickTo(-5000); // deep retreat by a third party
        assertEq(book.claimable(id), claimableBefore, "claimable unchanged");
        assertEq(book.unfilledPrincipal(id), principalBefore, "principal unchanged");
        assertEq(book.activeLiquidity(1), 0, "no resurrection via retreat");
    }

    // ------------------------------------------------------------------
    // Ephemeral parallel markets
    // ------------------------------------------------------------------

    function testFactoryParallelMarkets() public {
        FrontierBookFactory factory = newFactory(address(0));
        MockERC20 a = new MockERC20("A", "A");
        MockERC20 b = new MockERC20("B", "B");

        // same pair, three parallel books with different granularities
        int24[3] memory spacings = [int24(1), 10, 60];
        RollingFrontierBook[3] memory bk;
        for (uint256 i = 0; i < 3; i++) {
            bk[i] = RollingFrontierBook(factory.createBook(address(a), address(b), spacings[i], 0));
        }
        assertEq(factory.bookCount(), 3, "three books");

        a.mint(bob, 1e30);
        b.mint(taker, 1e30);
        uint256[3] memory ids;
        for (uint256 i = 0; i < 3; i++) {
            vm.prank(bob);
            a.approve(address(bk[i]), type(uint256).max);
            vm.prank(taker);
            b.approve(address(bk[i]), type(uint256).max);
            // one order per book, aligned to its own spacing
            vm.prank(bob);
            ids[i] = bk[i].deposit(spacings[i], spacings[i] * 4, L);
        }

        // fill only the middle book; the others must be untouched
        vm.prank(taker);
        bk[1].moveTickTo(20);

        assertEq(bk[0].claimable(ids[0]), 0, "book 0 isolated");
        assertGt(bk[1].claimable(ids[1]), 0, "book 1 filled");
        assertEq(bk[2].claimable(ids[2]), 0, "book 2 isolated");

        // settle everything everywhere; books end empty and abandonable
        vm.startPrank(bob);
        bk[0].cancel(ids[0]);
        bk[1].cancel(ids[1]);
        bk[2].cancel(ids[2]);
        vm.stopPrank();
        for (uint256 i = 0; i < 3; i++) {
            assertEq(a.balanceOf(address(bk[i])), 0, "no stranded principal");
        }

        uint256 g = gasleft();
        factory.createBook(address(a), address(b), 5, 0);
        console2.log("book deployment gas:", g - gasleft());
    }

    function testFactoryGeometricBooks() public {
        FrontierBookFactory factory = newFactory(address(0));
        MockERC20 a = new MockERC20("A", "A");
        MockERC20 b = new MockERC20("B", "B");

        GeometricFrontierBook geo = GeometricFrontierBook(factory.createGeoBook(address(a), address(b), 1, 0));
        assertEq(factory.bookCount(), 1, "registered");
        assertEq(factory.defaultBook(address(a), address(b)), address(geo), "pair default");
        assertGt(geo.geoD(), 0, "geometric curve bound");

        a.mint(bob, 1e30);
        b.mint(taker, 1e30);
        vm.prank(bob);
        a.approve(address(geo), type(uint256).max);
        vm.prank(taker);
        b.approve(address(geo), type(uint256).max);

        // the geometric variant really is wired in: shaped ladders refused
        vm.prank(bob);
        vm.expectRevert(bytes("geometric: uniform only"));
        geo.depositShaped(1, 4, L, 1);

        // end-to-end fill settles to the telescoped geometric value
        vm.prank(bob);
        uint256 id = geo.deposit(1, 4, L);
        vm.prank(taker);
        geo.moveTickTo(4);
        vm.prank(bob);
        uint256 proceeds = geo.claim(id);
        uint256 expect = (uint256(L) * (GeoTickMath.powX18(4) - GeoTickMath.powX18(1))) / geo.geoD();
        assertApproxEqAbs(proceeds, expect, 2, "telescoped settlement");
        assertEq(a.balanceOf(address(geo)), 0, "no stranded principal");

        // maker-ops companion memoized per config AND per curve
        GeometricFrontierBook geo2 = GeometricFrontierBook(factory.createGeoBook(address(a), address(b), 1, 50));
        assertEq(geo2.makerOps(), geo.makerOps(), "geo companion reused");
        RollingFrontierBook lin = RollingFrontierBook(factory.createBook(address(a), address(b), 1, 0));
        assertTrue(lin.makerOps() != geo.makerOps(), "curves never share a companion");
        assertEq(factory.bookCount(), 3, "all curves registered");

        // delegatecalled geometric companion serves a factory-made book
        vm.startPrank(bob);
        a.approve(address(geo2), type(uint256).max);
        uint256 id2 = geo2.deposit(51, 54, L);
        geo2.cancel(id2);
        vm.stopPrank();
        assertEq(a.balanceOf(address(geo2)), 0, "cancel refunds via companion");
    }
}
