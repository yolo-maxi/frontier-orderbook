// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {MockERC20} from "../src/MockERC20.sol";
import {RollingFrontierBook} from "../src/RollingFrontierBook.sol";

/// @notice "Tick ozempic": endpoint-telescoped sweeps. Ticks stay thin
/// (full price precision); a sweep settles each run BETWEEN order endpoints
/// with one closed-form series + one absorption, and records one high-water
/// entry per sweep instead of a clock stamp per level. A 5% move across
/// hundreds of dense active thin levels costs O(order endpoints), not
/// O(levels).
contract FrontierOzempicTest is Test {
    MockERC20 internal t0;
    MockERC20 internal t1;
    RollingFrontierBook internal book;

    address[5] internal makers;
    address internal taker;

    uint128 internal constant L = 1e18;

    function setUp() public {
        t0 = new MockERC20("T0", "T0");
        t1 = new MockERC20("T1", "T1");
        // spacing 1, rate curve 0.1%/tick: 500 ticks ~ a 5% move
        book = new RollingFrontierBook(address(t0), address(t1), 1, 0);
        for (uint256 i = 0; i < 5; i++) {
            makers[i] = makeAddr(string(abi.encodePacked("maker", vm.toString(i))));
            t0.mint(makers[i], 1e30);
            vm.prank(makers[i]);
            t0.approve(address(book), type(uint256).max);
        }
        taker = makeAddr("taker");
        t1.mint(taker, 1e30);
        vm.prank(taker);
        t1.approve(address(book), type(uint256).max);
    }

    function spanAmt1(int24 a, int24 b, uint256 liq) internal pure returns (uint256) {
        uint256 acc;
        for (int24 t = a; t < b; t++) {
            acc += liq * uint256(int256(1e18) + int256(t) * 1e15);
        }
        return acc / 1e18;
    }

    // ------------------------------------------------------------------
    // The headline: 5% move, 500 ACTIVE thin levels, 5 makers
    // ------------------------------------------------------------------

    function testFivePercentMoveAcrossDenseThinTicks() public {
        // 5 makers ladder 100 thin levels each, covering levels 1..501
        // contiguously with distinct sizes (every level is ACTIVE liquidity)
        uint256[5] memory ids;
        for (uint256 i = 0; i < 5; i++) {
            vm.prank(makers[i]);
            ids[i] = book.deposit(int24(1 + int256(i) * 100), int24(101 + int256(i) * 100), uint128(i + 1) * L);
        }
        for (int24 t = 1; t < 501; t++) {
            assertGt(book.activeLiquidity(t), 0, "every thin level is active");
        }

        // one taker sweep crosses all 500 active levels
        uint256 t0Before = t0.balanceOf(taker);
        vm.prank(taker);
        uint256 g = gasleft();
        book.moveTickTo(501);
        uint256 sweepGas = g - gasleft();
        console2.log("5% move, 500 active thin levels, 5 makers, sweep gas:", sweepGas);
        console2.log("settlement units (endpoint runs):", uint256(5));

        // the taker really bought all 500 levels' token0
        uint256 expected0 = 100 * (1 + 2 + 3 + 4 + 5) * uint256(L);
        assertEq(t0.balanceOf(taker) - t0Before, expected0, "all 500 levels really sold");

        // every maker's claim is exact to the wei vs brute-force per-level math
        for (uint256 i = 0; i < 5; i++) {
            int24 lo = int24(1 + int256(i) * 100);
            assertEq(
                book.claimable(ids[i]),
                spanAmt1(lo, lo + 100, (i + 1) * uint256(L)),
                "claim exact despite telescoped settlement"
            );
        }

        // far below the old per-level cost (500 levels x ~46k isolated)
        assertLt(sweepGas, 1_000_000, "cost is per-endpoint, not per-thin-level");
    }

    function testSweepGasIndependentOfTickFineness() public {
        // the same book value quoted at 10x finer ticks must not cost more
        // to sweep: one maker, one endpoint, any number of thin levels
        uint24[3] memory levels = [uint24(50), 500, 5000];
        uint256[3] memory gasUsed;
        for (uint256 c = 0; c < levels.length; c++) {
            t0 = new MockERC20("T0", "T0");
            t1 = new MockERC20("T1", "T1");
            book = new RollingFrontierBook(address(t0), address(t1), 1, 0);
            t0.mint(makers[0], 1e30);
            vm.prank(makers[0]);
            t0.approve(address(book), type(uint256).max);
            t1.mint(taker, 1e30);
            vm.prank(taker);
            t1.approve(address(book), type(uint256).max);

            vm.prank(makers[0]);
            book.deposit(1, 1 + int24(levels[c]), L);
            vm.prank(taker);
            uint256 g = gasleft();
            book.moveTickTo(1 + int24(levels[c]));
            gasUsed[c] = g - gasleft();
            console2.log("sweep gas at tick-fineness (levels in same span):", levels[c], gasUsed[c]);
        }
        // Residual scaling is the bitmap WORD walk between endpoints:
        // one cold word read per 256 levels (~2.1k), NOT per-level work.
        // 50 -> 5000 levels adds ~19 words; assert growth stays word-bounded.
        uint256 wordBudget = (uint256(levels[2] - levels[0]) / 256 + 2) * 2600;
        assertLt(gasUsed[2] - gasUsed[0], wordBudget, "growth must be word-bounded (1/256 compression)");
        // and nothing remotely like per-level cost (~46k/level previously)
        assertLt(gasUsed[2], gasUsed[0] + uint256(levels[2]) * 1_000, "no per-level scaling");
    }

    // ------------------------------------------------------------------
    // Invariants survive telescoping
    // ------------------------------------------------------------------

    function testFreshnessAndNoResurrectionAcrossTelescopedSweeps() public {
        vm.prank(makers[0]);
        uint256 bob = book.deposit(1, 401, L); // 400 thin levels
        vm.prank(taker);
        book.moveTickTo(201); // one run consumes 200 levels

        uint256 bobClaim = book.claimable(bob);
        assertEq(bobClaim, spanAmt1(1, 201, L), "half consumed");

        // deep reversal: nothing resurrects
        book.moveTickTo(0);
        assertEq(book.claimable(bob), bobClaim, "no resurrection");
        assertEq(book.activeLiquidity(100), 0, "consumed levels stay gone");

        // carol joins the consumed region; second pass is hers alone
        vm.prank(makers[1]);
        uint256 carol = book.deposit(1, 201, 2 * L);
        vm.prank(taker);
        book.moveTickTo(201);
        assertEq(book.claimable(carol), spanAmt1(1, 201, 2 * L), "second fill is carol's");
        assertEq(book.claimable(bob), bobClaim, "bob unchanged: freshness via high-water clocks");

        // bob's remaining tail still fills correctly above
        vm.prank(taker);
        book.moveTickTo(401);
        assertEq(book.claimable(bob), spanAmt1(1, 401, L), "tail consumed exactly once");
    }

    function testMidRunBudgetParkAndResume() public {
        vm.prank(makers[0]);
        uint256 id = book.deposit(1, 301, L); // one order, 300 thin levels

        // taker can only afford ~120 levels: the run subdivides via the
        // closed form and parks mid-run at a thin-tick boundary
        uint256 budget = spanAmt1(1, 121, L) + 1;
        vm.prank(taker);
        (int24 reached, uint256 paid,) =
            book.sweepWithLimits(301, type(uint256).max, budget, 0, block.timestamp);

        assertEq(reached, 121, "parked mid-run at exact thin-tick affordability");
        assertLe(paid, budget, "never exceeds maxPay");
        assertEq(book.claimable(id), spanAmt1(1, 121, L), "partial run paid exactly");

        // resume completes the rest; totals exact
        vm.prank(taker);
        book.sweepWithLimits(301, type(uint256).max, type(uint256).max, 0, block.timestamp);
        assertEq(book.claimable(id), spanAmt1(1, 301, L), "resume exact, no double-sell");
    }

    function testShapedLadderTelescopes() public {
        // shaped order: sizes 500L..1L over 500 thin levels — still one run
        vm.prank(makers[0]);
        uint256 id = book.depositShaped(1, 501, 500 * L, -int128(L));

        vm.prank(taker);
        uint256 g = gasleft();
        book.moveTickTo(501);
        uint256 sweepGas = g - gasleft();
        console2.log("shaped 500-level ladder, one telescoped run:", sweepGas);

        // brute-force exact claim check
        uint256 acc;
        for (int24 t = 1; t < 501; t++) {
            acc += (uint256(500 - uint24(t - 1)) * L) * uint256(int256(1e18) + int256(t) * 1e15);
        }
        assertEq(book.claimable(id), acc / 1e18, "quadratic-series settlement exact to the wei");
        assertLt(sweepGas, 400_000, "shape does not break telescoping");
    }
}
