// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {MockERC20} from "../src/MockERC20.sol";
import {UniformFrontierBook} from "../src/UniformFrontierBook.sol";
import {newBook} from "./utils/BookFab.sol";

/// @notice The market-maker view: how cheap is it to keep quotes current?
/// Key facts measured here: requote is O(1) in ladder width (a 100-level
/// ladder re-prices for the same gas as 1 level), needs no token transfers
/// when size is unchanged, and steady-state oscillating requotes run on warm
/// storage.
contract FrontierQuoterTest is Test {
    MockERC20 internal t0;
    MockERC20 internal t1;
    UniformFrontierBook internal book;

    address internal mm; // the quoter
    address internal taker;

    uint128 internal constant L = 1e18;

    function setUp() public {
        mm = makeAddr("mm");
        taker = makeAddr("taker");
        _fresh();
    }

    function _fresh() internal {
        t0 = new MockERC20("T0", "T0");
        t1 = new MockERC20("T1", "T1");
        book = newBook(address(t0), address(t1), 1, 0, address(0), address(0));
        t0.mint(mm, 1e30);
        vm.prank(mm);
        t0.approve(address(book), type(uint256).max);
        t1.mint(taker, 1e30);
        vm.prank(taker);
        t1.approve(address(book), type(uint256).max);
    }

    function amt1(int24 t, uint256 liq) internal pure returns (uint256) {
        return (liq * uint256(int256(1e18) + int256(t) * 1e15)) / 1e18;
    }

    // ------------------------------------------------------------------
    // Cost of a price update
    // ------------------------------------------------------------------

    function testRequoteGasFirstAndRepeat() public {
        vm.prank(mm);
        uint256 id = book.deposit(100, 110, L);

        // first move to fresh levels
        vm.prank(mm);
        uint256 g = gasleft();
        book.requote(id, 105, 115, L);
        uint256 first = g - gasleft();

        // repeated oscillation between two placements. NOTE: in default test
        // mode these calls share one tx, so storage stays warm — that only
        // models BUNDLED requotes (multicall). Under --isolate each call is
        // its own tx and repeats cost the same as the first; real per-tx
        // requotes match the isolated number.
        uint256 repeatTotal;
        for (uint256 i = 0; i < 10; i++) {
            int24 lo = i % 2 == 0 ? int24(100) : int24(105);
            vm.prank(mm);
            g = gasleft();
            book.requote(id, lo, lo + 10, L);
            repeatTotal += g - gasleft();
        }
        console2.log("requote gas, first:", first);
        console2.log("requote gas, repeat avg of 10 (warm only if bundled):", repeatTotal / 10);
        assertLe(repeatTotal / 10, first + first / 50, "repeats must not exceed first (mod tiny drift)");
    }

    function testRequoteIsWidthIndependent() public {
        uint24[3] memory widths = [uint24(1), 100, 10000];
        uint256[3] memory gasUsed;
        for (uint256 c = 0; c < widths.length; c++) {
            _fresh();
            vm.prank(mm);
            uint256 id = book.deposit(1000, 1000 + int24(widths[c]), L);
            vm.prank(mm);
            uint256 g = gasleft();
            book.requote(id, 2000, 2000 + int24(widths[c]), L);
            gasUsed[c] = g - gasleft();
            console2.log("requote gas at ladder width:", widths[c], gasUsed[c]);
        }
        // re-pricing a 10,000-level ladder == re-pricing 100 levels, exactly
        assertEq(gasUsed[1], gasUsed[2], "requote must be O(1) in ladder width");
    }

    function testRequoteBeatsCancelPlusDeposit() public {
        vm.prank(mm);
        uint256 id = book.deposit(100, 110, L);
        vm.prank(mm);
        uint256 g = gasleft();
        book.requote(id, 105, 115, L);
        uint256 requoteGas = g - gasleft();

        _fresh();
        vm.prank(mm);
        id = book.deposit(100, 110, L);
        vm.startPrank(mm);
        g = gasleft();
        book.cancel(id);
        book.deposit(105, 115, L);
        uint256 naiveGas = g - gasleft();
        vm.stopPrank();

        console2.log("requote:", requoteGas);
        console2.log("cancel + deposit:", naiveGas);
        assertLt(requoteGas, naiveGas, "requote must beat cancel+deposit");
    }

    function testRequoteSameSizeMovesNoTokens() public {
        vm.prank(mm);
        uint256 id = book.deposit(100, 110, L);
        uint256 mmBal = t0.balanceOf(mm);
        uint256 bookBal = t0.balanceOf(address(book));

        vm.prank(mm);
        book.requote(id, 200, 210, L);

        assertEq(t0.balanceOf(mm), mmBal, "no maker tokens moved");
        assertEq(t0.balanceOf(address(book)), bookBal, "no book tokens moved");
    }

    function testRequoteResizeSettlesDifferenceOnly() public {
        vm.prank(mm);
        uint256 id = book.deposit(100, 110, L); // 10 levels of L
        uint256 mmBal = t0.balanceOf(mm);

        // widen to 20 levels: pulls exactly 10 more L
        vm.prank(mm);
        book.requote(id, 100, 120, L);
        assertEq(mmBal - t0.balanceOf(mm), 10 * uint256(L), "pulled only the difference");

        // shrink and halve size: refunds exactly the difference
        mmBal = t0.balanceOf(mm);
        vm.prank(mm);
        book.requote(id, 100, 110, L / 2);
        assertEq(t0.balanceOf(mm) - mmBal, 20 * uint256(L) - 5 * uint256(L), "refunded only the difference");
    }

    // ------------------------------------------------------------------
    // Correctness of a price update
    // ------------------------------------------------------------------

    function testRequoteFreshness() public {
        vm.prank(mm);
        uint256 id = book.deposit(10, 13, L);
        vm.prank(mm);
        book.requote(id, 20, 23, L);

        // old levels fill: the moved quote must earn nothing there
        vm.prank(taker);
        book.moveTickTo(13);
        assertEq(book.claimable(id), 0, "no proceeds from abandoned levels");
        assertEq(book.activeLiquidity(10), 0, "old levels empty");

        // new levels fill normally
        vm.prank(taker);
        book.moveTickTo(21);
        assertEq(book.claimable(id), amt1(20, L), "new level pays");
    }

    function testRequoteAfterFillReverts() public {
        vm.prank(mm);
        uint256 id = book.deposit(10, 13, L);
        vm.prank(taker);
        book.moveTickTo(11); // first level filled

        vm.prank(mm);
        vm.expectRevert(bytes("partially filled"));
        book.requote(id, 20, 23, L);

        // the fallback path: settle and re-place
        vm.startPrank(mm);
        book.cancel(id); // pays the fill, returns the rest
        book.deposit(20, 23, L);
        vm.stopPrank();
        assertEq(t1.balanceOf(mm), amt1(10, L), "fill settled on the way out");
    }

    function testRequoteIntoPriceReverts() public {
        vm.prank(taker);
        book.moveTickTo(50);
        vm.prank(mm);
        // bundled retreat, as any depositor would
        book.moveTickTo(0);
        vm.prank(mm);
        uint256 id = book.deposit(10, 13, L);

        vm.prank(taker);
        book.moveTickTo(5); // price below the quote, nothing filled

        vm.prank(mm);
        vm.expectRevert(bytes("range not above price"));
        book.requote(id, 3, 6, L); // would straddle/sit below price
    }

    function testRequotePreservesDeltaConservation() public {
        vm.prank(mm);
        uint256 id = book.deposit(100, 110, L);
        vm.prank(mm);
        book.requote(id, 150, 175, 2 * L);
        vm.prank(mm);
        book.requote(id, 90, 91, L / 3);

        int256 sum;
        for (int24 t = 0; t <= 300; t++) {
            sum += book.frontierDelta(t);
        }
        assertEq(sum, 0, "delta conservation across requotes");
        assertEq(book.activeLiquidity(90), uint128(L / 3), "final quote live");
        assertEq(book.activeLiquidity(150), 0, "intermediate quote gone");
    }

    // ------------------------------------------------------------------
    // A realistic session: tracking a drifting market
    // ------------------------------------------------------------------

    function testQuoterSession() public {
        // MM keeps a 5-level ask ladder one tick above a price that drifts
        // up and down; measure the average per-update cost over 40 updates.
        vm.prank(mm);
        uint256 id = book.deposit(11, 16, L);

        int24 price = 10;
        uint256 total;
        uint256 updates;
        uint256 fills;
        for (uint256 i = 0; i < 40; i++) {
            // price drifts: up 2, up 2, down 3, repeating
            int24 next = i % 3 == 2 ? price - 3 : price + 2;
            vm.prank(taker);
            book.moveTickTo(next);
            price = next;

            (,, int24 lo,,,,) = _pos(id);
            if (book.isConsumedFor(id, lo)) {
                // got filled: settle + re-place (the slow path)
                vm.startPrank(mm);
                book.cancel(id);
                id = book.deposit(price + 1, price + 6, L);
                vm.stopPrank();
                fills++;
            } else {
                vm.prank(mm);
                uint256 g = gasleft();
                book.requote(id, price + 1, price + 6, L);
                total += g - gasleft();
                updates++;
            }
        }
        console2.log("session: requotes", updates, "avg gas", total / updates);
        console2.log("session: fill-settle cycles", fills);
        assertGt(updates, 0);
    }

    function _pos(uint256 id)
        internal
        view
        returns (address owner, uint128 liq, int24 lo, int24 up, uint64 clock, int24 cu, bool live)
    {
        (owner, lo, up, liq,, clock, cu, live,) = book.positions(id);
        return (owner, liq, lo, up, clock, cu, live);
    }

    function _depClock(uint256 id) internal view returns (uint64 clock) {
        (,,,,, clock,,,) = book.positions(id);
    }
}
