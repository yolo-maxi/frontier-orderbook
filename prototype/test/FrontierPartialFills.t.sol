// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {MockERC20} from "../src/MockERC20.sol";
import {RollingFrontierBook} from "../src/RollingFrontierBook.sol";
import {FrontierHookFlags} from "../src/hooks/IFrontierHooks.sol";
import {MakerGridHook} from "../src/hooks/examples/MakerGridHook.sol";
import {newBook} from "./utils/BookFab.sol";

/// @notice Sub-tick partial fills via a COARSE MAKER GRID over a fine book:
/// the book runs at tickSpacing = 1 (taker/fill granularity), while a
/// MakerGridHook restricts maker placement to multiples of 1000. A taker
/// parking mid-interval (e.g. at 1234 inside [1000, 2000)) leaves the
/// surviving liquidity as a frontier delta AT 1234 — the "watermark" of the
/// reverted bucket design, but encoded positionally, so multiple cohorts
/// with different remaining fractions are just multiple deltas at different
/// ticks, consumed strictly in price order. No cohort indices, no new state.
contract FrontierPartialFillsTest is Test {
    MockERC20 internal t0;
    MockERC20 internal t1;
    RollingFrontierBook internal book;
    MakerGridHook internal hook;

    address internal mmA;
    address internal mmB;
    address internal taker;

    int24 internal constant GRID = 1000;
    uint256 internal constant MAX = type(uint256).max;

    function setUp() public {
        mmA = makeAddr("mmA");
        mmB = makeAddr("mmB");
        taker = makeAddr("taker");
        t0 = new MockERC20("T0", "T0");
        t1 = new MockERC20("T1", "T1");

        address hookAddr = address((uint160(0xC0FFEE) << 20) | FrontierHookFlags.BEFORE_DEPOSIT_FLAG);
        deployCodeTo("MakerGridHook.sol:MakerGridHook", abi.encode(GRID), hookAddr);
        hook = MakerGridHook(hookAddr);

        // fine fill grid (spacing 1), price starts at 0
        book = newBook(address(t0), address(t1), 1, 0, hookAddr, address(0));

        for (uint256 i = 0; i < 3; i++) {
            address who = [mmA, mmB, taker][i];
            t0.mint(who, 1e30);
            t1.mint(who, 1e30);
            vm.startPrank(who);
            t0.approve(address(book), MAX);
            t1.approve(address(book), MAX);
            vm.stopPrank();
        }
    }

    // ------------------------------------------------------------------
    // helpers
    // ------------------------------------------------------------------

    function dep(address who, int24 lo, int24 up, uint128 size) internal returns (uint256 id) {
        vm.prank(who);
        id = book.deposit(lo, up, size);
    }

    function sweepTo(int24 target) internal returns (int24 reached, uint256 paid, uint256 received) {
        vm.prank(taker);
        (reached, paid, received) = book.sweepWithLimits(target, MAX, MAX, 0, block.timestamp);
    }

    /// raw token1 value (X18-scaled by 1e18) of `size` token0 per tick over
    /// [a, b) at the book's linear rate curve rate(t) = 1e18 + t*1e15
    function rawVal(int24 a, int24 b, uint256 size) internal pure returns (uint256) {
        int256 n = int256(b) - int256(a);
        int256 sumT = ((int256(a) + int256(b) - 1) * n) / 2;
        int256 v = int256(size) * (n * 1e18 + sumT * 1e15);
        require(v >= 0, "neg val");
        return uint256(v);
    }

    function ceilVal(int24 a, int24 b, uint256 size) internal pure returns (uint256) {
        return (rawVal(a, b, size) + 1e18 - 1) / 1e18;
    }

    function floorVal(int24 a, int24 b, uint256 size) internal pure returns (uint256) {
        return rawVal(a, b, size) / 1e18;
    }

    // ------------------------------------------------------------------
    // 1. taker parks mid-interval; maker is partially filled to 1234
    // ------------------------------------------------------------------

    function testTakerParksMidIntervalMakerPartiallyFilled() public {
        uint256 id = dep(mmA, 1000, 5000, 10); // 10 token0 per fine tick

        (int24 reached, uint256 paid, uint256 received) = sweepTo(1234);
        assertEq(reached, 1234, "parks at the exact fine tick");
        assertEq(book.currentTick(), 1234, "pointer mid coarse interval");
        assertEq(received, 234 * 10, "taker bought exactly the sub-span");
        assertEq(paid, ceilVal(1000, 1234, 10), "taker paid the sub-span value");

        // sold fraction is claimable immediately; rest still resting
        assertEq(book.claimable(id), floorVal(1000, 1234, 10), "sold fraction claimable");
        assertEq(book.unfilledPrincipal(id), uint256(10) * 3766, "unsold tail intact");

        // the survivor frontier rests AT the watermark tick
        assertEq(book.frontierDelta(1234), 10, "watermark = frontier delta at 1234");
        assertEq(book.frontierDelta(1000), 0, "old frontier absorbed");
    }

    /// PRODUCT INVARIANT: a taker with any budget executes up to that budget;
    /// a fat maker interval can never block execution.
    function testTakerBudgetSubdividesFatInterval() public {
        dep(mmA, 1000, 5000, 10);

        uint256 budget = ceilVal(1000, 1037, 10); // affords exactly 37 fine ticks
        vm.prank(taker);
        (int24 reached, uint256 paid, uint256 received) =
            book.sweepWithLimits(5000, MAX, budget, 0, block.timestamp);
        assertEq(reached, 1037, "parks at the exact affordable tick");
        assertEq(received, 37 * 10, "partial execution, no revert");
        assertLe(paid, budget, "budget respected");

        // a later sweep resumes exactly where the first parked
        (reached,, received) = sweepTo(1100);
        assertEq(reached, 1100, "resume");
        assertEq(received, 63 * 10, "continues from the park point");
    }

    // ------------------------------------------------------------------
    // 2. maker claims / cancels the sold fraction correctly
    // ------------------------------------------------------------------

    function testClaimPartialThenCompletionTelescopes() public {
        uint256 id = dep(mmA, 1000, 5000, 10);
        sweepTo(1234);

        uint256 balBefore = t1.balanceOf(mmA);
        vm.prank(mmA);
        uint256 first = book.claim(id);
        assertEq(first, floorVal(1000, 1234, 10), "mid-lifecycle partial claim");
        assertEq(t1.balanceOf(mmA) - balBefore, first, "proceeds out");

        sweepTo(2000);
        vm.prank(mmA);
        uint256 second = book.claim(id);
        assertEq(second, floorVal(1234, 2000, 10), "remainder of the coarse interval");

        // two part-floors vs one full-floor: equal up to 1 wei of dust,
        // never an overclaim
        uint256 whole = floorVal(1000, 2000, 10);
        assertLe(first + second, whole, "no overclaim");
        assertLe(whole - (first + second), 1, "at most 1 wei dust");
    }

    function testCancelMidPartialReturnsProceedsPlusUnsoldPrincipal() public {
        uint256 id = dep(mmA, 1000, 5000, 10);
        sweepTo(1234);

        vm.prank(mmA);
        (uint256 proceeds1, uint256 principal0) = book.cancel(id);
        assertEq(proceeds1, floorVal(1000, 1234, 10), "sold fraction paid in token1");
        assertEq(principal0, uint256(10) * 3766, "unsold tail returned in token0");

        // book is empty: deltas cleared at the watermark and at upper
        assertEq(book.frontierDelta(1234), 0, "watermark delta removed");
        assertEq(book.frontierDelta(5000), 0, "upper delta removed");
        (, uint256 paid, uint256 received) = sweepTo(5000);
        assertEq(paid + received, 0, "nothing left to sell");

        // book solvency: only collect-ceil/pay-floor dust may remain
        assertEq(t0.balanceOf(address(book)), 0, "token0 fully accounted");
        assertLe(t1.balanceOf(address(book)), 1, "token1 dust only");
    }

    // ------------------------------------------------------------------
    // 3 + 4. new maker enters as a SEPARATE frontier; the next taker moves
    // through the lower frontier before touching the watermarked cohort
    // ------------------------------------------------------------------

    function testSeparateFrontierCohortsConsumeInPriceOrder() public {
        uint256 idA = dep(mmA, 1000, 5000, 10);
        sweepTo(1234); // A's frontier now rests at 1234

        // price retreats below the coarse boundary; B enters on the grid.
        // Two cohorts now coexist inside [1000, 2000): B at frontier 1000
        // (full interval) and A at frontier 1234 (remaining fraction).
        vm.prank(taker);
        book.moveTickTo(500);
        uint256 idB = dep(mmB, 1000, 5000, 20);

        // taker below A's watermark: ONLY B sells
        (, uint256 paid1, uint256 received1) = sweepTo(1100);
        assertEq(received1, 100 * 20, "only the fresh cohort sells below 1234");
        assertEq(paid1, ceilVal(1000, 1100, 20), "priced for B alone");
        assertEq(book.claimable(idA), floorVal(1000, 1234, 10), "A unchanged");

        // crossing the watermark: both cohorts sell from 1234 up
        (, uint256 paid2, uint256 received2) = sweepTo(1300);
        assertEq(received2, 134 * 20 + 66 * 30, "B alone to 1234, both after");
        assertEq(paid2, ceilVal(1100, 1234, 20) + ceilVal(1234, 1300, 30), "two runs, priced per cohort");

        assertEq(book.claimable(idA), floorVal(1000, 1300, 10), "A: [1000,1234) + [1234,1300)");
        assertEq(book.claimable(idB), floorVal(1000, 1300, 20), "B: [1000,1300)");
    }

    function testNewMakerAbovePointerNeedsNoRetreat() public {
        dep(mmA, 1000, 5000, 10);
        sweepTo(1234);

        // pointer rests at 1234: the next grid boundary up is the lowest
        // legal fresh placement. The orphaned remainder [1234, 2000) belongs
        // to existing cohorts only — that's the accepted placement tradeoff.
        vm.prank(mmB);
        vm.expectRevert(bytes("range not above price"));
        book.deposit(1000, 5000, 20);

        uint256 idB = dep(mmB, 2000, 5000, 20); // allowed, separate frontier
        (,, uint256 received) = sweepTo(2100);
        assertEq(received, 766 * 10 + 100 * 30, "A's tail to 2000, both after");
        assertEq(book.claimable(idB), floorVal(2000, 2100, 20), "B sells only above 2000");
    }

    // ------------------------------------------------------------------
    // 5. no double-sell / resurrection after retreat and re-entry
    // ------------------------------------------------------------------

    function testNoResurrectionAfterRetreatAndReentry() public {
        uint256 id = dep(mmA, 1000, 5000, 10);
        (,, uint256 sold1) = sweepTo(1234);

        vm.prank(taker);
        book.moveTickTo(500); // free retreat

        // re-entering the already-sold sub-span sells NOTHING again
        (int24 reached, uint256 paid, uint256 received) = sweepTo(1234);
        assertEq(reached, 1234, "pointer glides through spent span");
        assertEq(paid + received, 0, "spent asks stay spent");

        // advancing past the watermark sells only the new sub-span
        (,, uint256 sold2) = sweepTo(2000);
        assertEq(sold2, 766 * 10, "only [1234,2000) sells");
        assertEq(sold1 + sold2, 1000 * 10, "interval sold exactly once in total");

        // single claim spans the whole sold prefix, exactly once
        vm.prank(mmA);
        assertEq(book.claim(id), floorVal(1000, 2000, 10), "one full-rate payout");

        // conservation: book still holds the unsold tail principal
        assertEq(t0.balanceOf(address(book)), uint256(10) * 3000, "tail principal intact");
    }

    // ------------------------------------------------------------------
    // placement policy: coarse grid enforced on every placement path
    // ------------------------------------------------------------------

    function testMakerGridEnforcedOnDepositsRequotesAndBids() public {
        vm.startPrank(mmA);
        vm.expectRevert(bytes("hook rejected"));
        book.deposit(1123, 5000, 10);
        vm.expectRevert(bytes("hook rejected"));
        book.deposit(1000, 4321, 10);

        uint256 id = book.deposit(1000, 2000, 10); // on-grid passes

        // requote cannot escape the grid (re-placement sees the hook)
        vm.expectRevert(bytes("hook rejected"));
        book.requote(id, 1123, 3000, 10);
        book.requote(id, 3000, 4000, 10); // on-grid requote passes

        // bid side mirrors the policy
        vm.expectRevert(bytes("hook rejected"));
        book.depositBid(-1234, 0, 5);
        uint256 bidId = book.depositBid(-1000, 0, 5);
        vm.expectRevert(bytes("hook rejected"));
        book.requoteBid(bidId, -2123, -1000, 5);
        vm.stopPrank();
    }

    // ------------------------------------------------------------------
    // the cost that made fine spacing scary — killed by the two-level
    // bitmap: gap navigation reads one TOP word per 65,536 fine ticks and
    // descends into a fine word only where endpoints actually exist
    // ------------------------------------------------------------------

    function testWideEmptyGapSweepIsCoarseCost() public {
        dep(mmA, 99000, 100000, 10); // far above price; ~99k empty fine ticks below

        vm.prank(taker);
        uint256 g = gasleft();
        book.sweepWithLimits(100000, MAX, MAX, 0, block.timestamp);
        uint256 used = g - gasleft();

        // single-level fine bitmap would walk ~387 cold words (~800k gas);
        // two-level: ~2 top words + 2 fine words + the fill itself
        assertLt(used, 200_000, "gap walk no longer scales with fine ticks");
        assertEq(book.currentTick(), 100000, "filled the far ladder");
    }

    // ------------------------------------------------------------------
    // bid-side mirror: down-sweep parks mid-interval in a coarse bid
    // ------------------------------------------------------------------

    function testBidPartialParkMirror() public {
        vm.prank(mmA);
        uint256 bidId = book.depositBid(-1000, 0, 5); // buy 5 token0 per tick

        vm.prank(taker);
        (int24 reached,, uint256 received1) = book.sweepWithLimits(-321, MAX, MAX, 0, block.timestamp);
        assertEq(reached, -321, "down-sweep parks at the exact fine tick");
        assertEq(received1, floorVal(-321, 0, 5), "taker received token1 for the sub-span");

        assertEq(book.bidClaimable(bidId), 321 * 5, "bid bought the sub-span of token0");
        vm.prank(mmA);
        assertEq(book.claimBid(bidId), 321 * 5, "partial bid claim pays");

        // remaining depth still live below the park point
        vm.prank(taker);
        (reached,,) = book.sweepWithLimits(-1000, MAX, MAX, 0, block.timestamp);
        assertEq(reached, -1000, "rest of the bid fills");
        vm.prank(mmA);
        assertEq(book.claimBid(bidId), 679 * 5, "remainder claimed");
    }
}
