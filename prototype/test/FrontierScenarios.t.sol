// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ScenarioSuite} from "./Scenarios.t.sol";
import {IRangeOrderBook} from "../src/IRangeOrderBook.sol";
import {RollingFrontierBook} from "../src/RollingFrontierBook.sol";
import {newBook} from "./utils/BookFab.sol";

/// @notice The full spec scenario suite against the rolling-frontier book
/// (via its O(width) convenience claim/cancel), plus tests specific to the
/// O(1) witness paths — including adversarial witnesses.
contract FrontierScenariosTest is ScenarioSuite {
    function _newBook(address token0, address token1_, int24 spacing_, int24 startTick)
        internal
        override
        returns (IRangeOrderBook)
    {
        return IRangeOrderBook(address(newBook(token0, token1_, spacing_, startTick, address(0), address(0))));
    }

    function _frontierBook() internal view returns (RollingFrontierBook) {
        return RollingFrontierBook(address(book));
    }

    // ------------------------------------------------------------------
    // O(1) witness claim path
    // ------------------------------------------------------------------

    function testWitnessClaim() public {
        uint256 id = dep(bob, 1, 100, L);
        book.moveTickTo(3); // fills [1,2) and [2,3)

        vm.prank(bob);
        uint256 paid = _frontierBook().claimTo(id, 3);
        assertEq(paid, amt1(1, L) + amt1(2, L), "span payout exact");
        assertEq(t1.balanceOf(bob), paid, "bob holds proceeds");

        // re-claiming the same span is rejected
        vm.prank(bob);
        vm.expectRevert(bytes("bad target"));
        _frontierBook().claimTo(id, 3);

        // claiming past the frontier is rejected
        vm.prank(bob);
        vm.expectRevert(bytes("not filled"));
        _frontierBook().claimTo(id, 4);
    }

    function testWitnessClaimIncremental() public {
        uint256 id = dep(bob, 1, 100, L);
        book.moveTickTo(5); // fills [1,5)

        // underclaiming is allowed and composable
        vm.prank(bob);
        assertEq(_frontierBook().claimTo(id, 2), amt1(1, L), "first span");
        vm.prank(bob);
        assertEq(_frontierBook().claimTo(id, 5), amt1(2, L) + amt1(3, L) + amt1(4, L), "rest of span");
    }

    function testWitnessStaleLifecycleRejected() public {
        dep(bob, 1, 100, L);
        book.moveTickTo(2); // fill stamps boundary 2 (clock 1)
        book.moveTickTo(0);
        uint256 carolId = dep(carol, 1, 100, L); // depositClock == 1

        // boundary 2's stamp predates carol's deposit: she cannot claim it
        vm.prank(carol);
        vm.expectRevert(bytes("not filled"));
        _frontierBook().claimTo(carolId, 2);

        book.moveTickTo(2); // second fill, fresh stamp
        vm.prank(carol);
        assertEq(_frontierBook().claimTo(carolId, 2), amt1(1, L), "carol claims her lifecycle");
    }

    // ------------------------------------------------------------------
    // O(1) witness cancel path
    // ------------------------------------------------------------------

    function testWitnessCancel() public {
        uint256 id = dep(bob, 1, 100, L);
        book.moveTickTo(3); // frontier is 3

        // non-maximal witness rejected (there are fills above 2)
        vm.prank(bob);
        vm.expectRevert(bytes("frontier not maximal"));
        _frontierBook().cancelWithWitness(id, 2);

        // overstated witness rejected
        vm.prank(bob);
        vm.expectRevert(bytes("frontier not filled"));
        _frontierBook().cancelWithWitness(id, 4);

        uint256 t0Before = t0.balanceOf(bob);
        vm.prank(bob);
        (uint256 proceeds1, uint256 principal0) = _frontierBook().cancelWithWitness(id, 3);
        assertEq(proceeds1, amt1(1, L) + amt1(2, L), "filled span paid");
        assertEq(principal0, 97 * uint256(L), "unfilled suffix returned");
        assertEq(t0.balanceOf(bob), t0Before + principal0, "token0 back");

        // liquidity is really gone
        assertEq(book.activeLiquidity(3), 0, "suffix removed");
        assertEq(book.activeLiquidity(99), 0, "suffix removed");
        book.moveTickTo(50);
        assertEq(t1.balanceOf(address(book)), 0, "no orphaned fills");
    }

    function testWitnessCancelFullyConsumed() public {
        uint256 id = dep(bob, 1, 3, L);
        book.moveTickTo(3); // whole order consumed; +L rolled into upper and self-cancelled

        vm.prank(bob);
        (uint256 proceeds1, uint256 principal0) = _frontierBook().cancelWithWitness(id, 3);
        assertEq(proceeds1, amt1(1, L) + amt1(2, L), "all proceeds");
        assertEq(principal0, 0, "nothing unfilled");
        assertEq(_frontierBook().frontierDelta(3), 0, "deltas self-cancelled");
    }

    // ------------------------------------------------------------------
    // Frontier-specific aggregate sanity
    // ------------------------------------------------------------------

    function testRollAccumulatesAcrossStaggeredRanges() public {
        // A=[1,4) and B=[2,4): B's delta sits at 2 until price arrives
        uint256 a = dep(bob, 1, 4, L);
        uint256 b = dep(eve, 2, 4, L);

        book.moveTickTo(2); // fills [1,2): A only
        assertEq(book.claimable(a), amt1(1, L), "A alone in [1,2)");
        assertEq(book.claimable(b), 0, "B starts at 2");

        book.moveTickTo(3); // fills [2,3): A rolled in + B
        assertEq(book.claimable(a), amt1(1, L) + amt1(2, L), "A in both");
        assertEq(book.claimable(b), amt1(2, L), "B in second");

        book.moveTickTo(4); // both orders end exactly at 4
        assertEq(_frontierBook().frontierDelta(4), 0, "both self-cancelled at upper");
        assertEq(book.unfilledPrincipal(a), 0, "A fully consumed");
        assertEq(book.unfilledPrincipal(b), 0, "B fully consumed");
    }
}
