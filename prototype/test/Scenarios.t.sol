// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BookTestBase} from "./BookTestBase.sol";
import {IRangeOrderBook} from "../src/IRangeOrderBook.sol";
import {RangeTakeProfitBook} from "../src/RangeTakeProfitBook.sol";
import {ReferenceBook} from "../src/ReferenceBook.sol";

/// @notice Scenario suite from accounting-scenarios.md / test-plan.md, written
/// against the common interface and run against BOTH implementations.
abstract contract ScenarioSuite is BookTestBase {
    // ------------------------------------------------------------------
    // Scenario A / testBasicPartialFill + testReversalDoesNotResurrect
    // ------------------------------------------------------------------

    function testBasicPartialFill() public {
        uint256 id = dep(bob, 1, 100, L);
        book.moveTickTo(2); // Alice buys through [1,2]

        assertEq(book.claimable(id), amt1(1, L), "claimable for [1,2]");
        assertEq(book.activeLiquidity(1), 0, "interval 1 consumed");
        assertTrue(book.isConsumedFor(id, 1), "bob consumed at 1");
        assertFalse(book.isConsumedFor(id, 2), "bob active at 2");
        assertEq(book.activeLiquidity(2), L, "interval 2 active");
        assertEq(book.activeLiquidity(99), L, "interval 99 active");
        assertEq(book.unfilledPrincipal(id), sumAmt0(2, 100, L), "principal for [2,100]");
    }

    function testReversalDoesNotResurrect() public {
        uint256 id = dep(bob, 1, 100, L);
        book.moveTickTo(2);
        uint256 claimableBefore = book.claimable(id);

        book.moveTickTo(0); // full reversal

        assertEq(book.claimable(id), claimableBefore, "claimable unchanged");
        assertEq(book.activeLiquidity(1), 0, "no resurrection");
        assertTrue(book.isConsumedFor(id, 1), "still consumed");
        assertEq(book.unfilledPrincipal(id), sumAmt0(2, 100, L), "no reverse conversion");

        // Second traversal of [1,2] pays nothing more to bob.
        book.moveTickTo(2);
        assertEq(book.claimable(id), claimableBefore, "no double fill");

        uint256 paid = claimAs(bob, id);
        assertEq(paid, claimableBefore, "claim pays once");
        assertEq(t1.balanceOf(bob), claimableBefore, "bob balance");
        assertEq(claimAs(bob, id), 0, "second claim pays zero");
    }

    // ------------------------------------------------------------------
    // Scenario B / testBobAliceCarolEpochIsolation
    // ------------------------------------------------------------------

    function testBobAliceCarolEpochIsolation() public {
        uint256 bobId = dep(bob, 1, 100, L);
        book.moveTickTo(2); // Alice consumes [1,2]
        book.moveTickTo(0); // price returns
        uint256 carolId = dep(carol, 1, 100, L);

        // Carol cannot claim earlier proceeds.
        assertEq(book.claimable(carolId), 0, "carol inherits nothing");
        assertEq(book.claimable(bobId), amt1(1, L), "bob keeps his fill");

        // Active liquidity: [1,2] Carol only; [2,100] Bob + Carol.
        assertEq(book.activeLiquidity(1), L, "interval 1: carol only");
        assertEq(book.activeLiquidity(2), 2 * L, "interval 2: bob + carol");
        assertEq(book.activeLiquidity(99), 2 * L, "interval 99: bob + carol");

        // Dave consumes [1,2] again.
        book.moveTickTo(2);
        assertEq(book.claimable(carolId), amt1(1, L), "second fill is carol's");
        assertEq(book.claimable(bobId), amt1(1, L), "bob gets nothing from second fill");

        // Consume [2,3]: shared pro-rata (equal liquidity here).
        book.moveTickTo(3);
        assertEq(book.claimable(bobId), amt1(1, L) + amt1(2, L), "bob shares [2,3]");
        assertEq(book.claimable(carolId), amt1(1, L) + amt1(2, L), "carol shares [2,3]");
    }

    // ------------------------------------------------------------------
    // Scenario C / testOverlappingRanges
    // ------------------------------------------------------------------

    function testOverlappingRanges() public {
        uint256 bobId = dep(bob, 1, 100, L);
        uint256 eveId = dep(eve, 2, 50, L);

        book.moveTickTo(3); // consume [1,3]

        assertEq(book.claimable(bobId), amt1(1, L) + amt1(2, L), "[1,2] bob only, [2,3] shared");
        assertEq(book.claimable(eveId), amt1(2, L), "eve only in [2,3]");

        // Both remain active over unfilled remainder.
        assertEq(book.activeLiquidity(3), 2 * L, "interval 3 active both");
        assertEq(book.activeLiquidity(49), 2 * L, "interval 49 active both");
        assertEq(book.activeLiquidity(50), L, "interval 50 bob only");
        assertEq(book.unfilledPrincipal(bobId), sumAmt0(3, 100, L), "bob remainder");
        assertEq(book.unfilledPrincipal(eveId), sumAmt0(3, 50, L), "eve remainder");
    }

    // ------------------------------------------------------------------
    // Scenario D / testSameLifecycleProRata
    // ------------------------------------------------------------------

    function testSameLifecycleProRata() public {
        uint256 bobId = dep(bob, 1, 100, L);
        uint256 eveId = dep(eve, 1, 100, 3 * L);

        book.moveTickTo(2);

        assertEq(book.claimable(bobId), amt1(1, L), "bob exact");
        assertEq(book.claimable(eveId), amt1(1, 3 * L), "eve exact");
        assertApproxEqAbs(book.claimable(eveId), 3 * book.claimable(bobId), 3, "eve gets 3x (mod rounding)");
        assertTrue(book.isConsumedFor(bobId, 1), "bob [1,2] consumed");
        assertTrue(book.isConsumedFor(eveId, 1), "eve [1,2] consumed");
    }

    // ------------------------------------------------------------------
    // Scenario E / testCancelAfterPartialFill
    // ------------------------------------------------------------------

    function testCancelAfterPartialFill() public {
        uint256 id = dep(bob, 1, 100, L);
        book.moveTickTo(2);

        uint256 t0Before = t0.balanceOf(bob);
        (uint256 proceeds1, uint256 principal0) = cancelAs(bob, id);

        assertEq(proceeds1, amt1(1, L), "proceeds for [1,2]");
        assertEq(principal0, sumAmt0(2, 100, L), "principal for [2,100]");
        assertEq(t1.balanceOf(bob), proceeds1, "token1 paid");
        assertEq(t0.balanceOf(bob), t0Before + principal0, "token0 returned");

        // No active order remains; later movement pays nothing.
        assertEq(book.activeLiquidity(2), 0, "liquidity removed");
        assertEq(book.activeLiquidity(99), 0, "liquidity removed");
        uint256 t1After = t1.balanceOf(bob);
        book.moveTickTo(50);
        assertEq(book.claimable(id), 0, "no future proceeds");
        assertEq(t1.balanceOf(bob), t1After, "no payout after cancel");
        vm.prank(bob);
        vm.expectRevert(bytes("not live"));
        book.claim(id);
    }

    // ------------------------------------------------------------------
    // testMultipleLifecyclesSameInterval
    // ------------------------------------------------------------------

    function testMultipleLifecyclesSameInterval() public {
        uint256 bobId = dep(bob, 1, 2, L);
        book.moveTickTo(2);
        book.moveTickTo(0);

        uint256 carolId = dep(carol, 1, 2, 2 * L);
        book.moveTickTo(2);
        book.moveTickTo(0);

        uint256 danId = dep(dan, 1, 2, 3 * L);
        book.moveTickTo(2);

        assertEq(book.claimable(bobId), amt1(1, L), "bob: lifecycle 1 only");
        assertEq(book.claimable(carolId), amt1(1, 2 * L), "carol: lifecycle 2 only");
        assertEq(book.claimable(danId), amt1(1, 3 * L), "dan: lifecycle 3 only");
    }

    // ------------------------------------------------------------------
    // testDelayedClaimEquivalence (claim-late vs claim-eagerly, same book)
    // ------------------------------------------------------------------

    function testDelayedClaimEquivalence() public {
        // bob claims after every fill, carol once at the end; identical
        // deposits must yield identical totals.
        uint256 bobId = dep(bob, 1, 50, L);
        uint256 carolId = dep(carol, 1, 50, L);

        book.moveTickTo(3);
        claimAs(bob, bobId);
        book.moveTickTo(1);
        book.moveTickTo(6);
        claimAs(bob, bobId);
        book.moveTickTo(0);
        book.moveTickTo(2); // refills nothing for bob/carol (consumed), no new deposits
        claimAs(bob, bobId);
        book.moveTickTo(10);
        claimAs(bob, bobId);

        claimAs(carol, carolId);
        assertEq(t1.balanceOf(bob), t1.balanceOf(carol), "claim timing must not matter");
    }

    // ------------------------------------------------------------------
    // testBoundaryRules
    // ------------------------------------------------------------------

    function testBoundary_DepositAtOrBelowCurrentTickReverts() public {
        book.moveTickTo(5);
        vm.prank(bob);
        vm.expectRevert(bytes("range not above price"));
        book.deposit(5, 10, L);
        vm.prank(bob);
        vm.expectRevert(bytes("range not above price"));
        book.deposit(3, 10, L);
        // first interval strictly above price is fine
        dep(bob, 6, 10, L);
    }

    function testBoundary_EmptyOrInvertedRangeReverts() public {
        vm.prank(bob);
        vm.expectRevert(bytes("empty range"));
        book.deposit(5, 5, L);
        vm.prank(bob);
        vm.expectRevert(bytes("empty range"));
        book.deposit(6, 5, L);
        vm.prank(bob);
        vm.expectRevert(bytes("zero liquidity"));
        book.deposit(5, 6, 0);
    }

    function testBoundary_MisalignedRangeReverts() public {
        _makeBook(10, 0);
        vm.prank(bob);
        vm.expectRevert(bytes("unaligned"));
        book.deposit(5, 30, L);
        vm.prank(bob);
        vm.expectRevert(bytes("unaligned"));
        book.deposit(10, 25, L);
        dep(bob, 10, 30, L); // aligned works
    }

    function testBoundary_SwapLandsExactlyOnBoundary() public {
        uint256 id = dep(bob, 1, 3, L);
        book.moveTickTo(2); // lands exactly on interval boundary 2

        // [1,2) fully crossed -> filled; [2,3) merely reached -> NOT filled.
        assertTrue(book.isConsumedFor(id, 1), "interval 1 filled");
        assertFalse(book.isConsumedFor(id, 2), "interval 2 not filled");
        assertEq(book.claimable(id), amt1(1, L), "only [1,2] pays");
    }

    function testBoundary_SwapStopsOneTickBeforeBoundary() public {
        uint256 id = dep(bob, 5, 7, L);
        book.moveTickTo(5); // reaches bob's lower edge, crosses nothing of his
        assertEq(book.claimable(id), 0, "nothing filled");
        assertEq(book.activeLiquidity(5), L, "still active");

        book.moveTickTo(6); // now [5,6) fully crossed
        assertEq(book.claimable(id), amt1(5, L), "[5,6) filled");
        assertEq(book.activeLiquidity(6), L, "[6,7) still active");
    }
}

contract ProdScenariosTest is ScenarioSuite {
    function _newBook(address token0, address token1_, int24 spacing, int24 startTick)
        internal
        override
        returns (IRangeOrderBook)
    {
        return IRangeOrderBook(address(new RangeTakeProfitBook(token0, token1_, spacing, startTick)));
    }

    // testRoundingDust — production-specific dust policy: each position is
    // paid floor(liquidity * rate); the bucket collects floor(total * rate);
    // dust accretes to the contract and claim order cannot change payouts.
    function testRoundingDust() public {
        uint256 bobId = dep(bob, 1, 2, 750);
        uint256 carolId = dep(carol, 1, 2, 750);

        book.moveTickTo(2);
        // bucket pulls floor(1500 * 1.001) = 1501; users get floor(750*1.001)=750 each
        assertEq(t1.balanceOf(address(book)), 1501, "bucket proceeds");

        uint256 expectBob = book.claimable(bobId);
        uint256 expectCarol = book.claimable(carolId);
        assertEq(expectBob, 750);
        assertEq(expectCarol, 750);

        // claim in either order: amounts are deterministic per position
        assertEq(claimAs(carol, carolId), expectCarol, "carol exact");
        assertEq(claimAs(bob, bobId), expectBob, "bob exact");
        assertEq(t1.balanceOf(address(book)), 1, "dust stays in book, no overclaim");
    }

    function testRoundingTinyLiquidity() public {
        uint256 id = dep(bob, 1, 2, 1); // 1 wei of liquidity
        book.moveTickTo(2);
        assertEq(book.claimable(id), 1, "floor(1 * 1.001) = 1");
        assertEq(t1.balanceOf(address(book)), 1, "bucket holds exactly the fill");
        claimAs(bob, id);
        assertEq(t1.balanceOf(address(book)), 0, "no dust at this size");
    }
}

contract RefScenariosTest is ScenarioSuite {
    function _newBook(address token0, address token1_, int24 spacing, int24 startTick)
        internal
        override
        returns (IRangeOrderBook)
    {
        return IRangeOrderBook(address(new ReferenceBook(token0, token1_, spacing, startTick)));
    }
}
