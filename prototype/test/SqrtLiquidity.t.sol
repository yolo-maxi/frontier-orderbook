// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {SqrtLiquidityMath as M} from "../src/sqrt/SqrtLiquidityMath.sol";
import {GeoTickMath} from "../src/curve/GeoTickMath.sol";

/// @notice Currency-neutral L-sizing: a position is (tickLower, tickUpper, L),
/// token amounts derived from sqrtP. Proves the properties that make this a
/// drop-in for the frontier book: exact per-level price, the token-swap
/// symmetry (a bid IS an ask reflected), solvency-safe telescoping, and O(1).
contract SqrtLiquidityTest is Test {
    uint128 internal constant L = 1e18;
    int24 internal constant S = 1; // tick spacing

    // ---- sqrtP is a faithful square root of the price curve ----
    function testSqrtPriceSquaresToPrice() public pure {
        int24[4] memory ts = [int24(0), int24(100), int24(-100), int24(5000)];
        for (uint256 i = 0; i < ts.length; i++) {
            uint256 s = M.sqrtPriceX18(ts[i]);
            uint256 p = GeoTickMath.powX18(ts[i]);
            // (sqrtP)^2 ~= P, within fixed-point rounding (a few parts in 1e18)
            assertApproxEqRel(s * s / 1e18, p, 1e6, "sqrtP^2 == P"); // 1e6/1e18 = 1e-12
        }
    }

    // ---- each level fills at EXACTLY its tick price (no thinness needed) ----
    function testPerLevelPriceIsExact() public pure {
        int24 t = 2000;
        uint256 a0 = M.leg0(t, L, true); // token0 escrowed by an ask
        uint256 a1 = M.leg1(t, L, false); // token1 received on fill
        // realized price a1/a0 == P(t), within rounding
        uint256 realized = a1 * 1e18 / a0;
        assertApproxEqRel(realized, GeoTickMath.powX18(t), 1e9, "realized == P(t)");
        // L is the geometric mean: a0*a1 ~= L^2
        assertApproxEqRel(M.isqrt(a0 * a1), uint256(L), 1e9, "L == sqrt(a0*a1)");
    }

    // ---- THE symmetry: a bid is an ask reflected (leg0(t) == leg1(-t)) ----
    function testTokenSwapSymmetry() public pure {
        for (int24 t = -3000; t <= 3000; t += 750) {
            // token0 an ASK of L needs at tick t  ==  token1 a BID of L needs
            // at the mirrored tick -t in the token-swapped frame
            uint256 ask0 = M.leg0(t, L, true);
            uint256 bid1Mirror = M.leg1(-t, L, true);
            assertApproxEqAbs(ask0, bid1Mirror, 4, "leg0(t) == leg1(-t)");
        }
    }

    // ---- single-level range == the leg (telescoping ~exact at n=1) ----
    // Closed-form telescoping uses (S(t+s)-S(t))/(S(s)-1e18); because S is an
    // independent isqrt per tick, that differs from L*S(t) by a few parts in
    // 1e14 (per-step floor). Production would derive S from a sqrt-tick table
    // so S(t+s)=S(t)*S(s)/1e18 holds by construction and this is exact.
    function testRangeOfOneLevelEqualsLeg() public pure {
        int24 t = 1500;
        assertApproxEqRel(M.amount1Range(t, t + S, S, L, false), M.leg1(t, L, false), 1e9, "1-level amount1");
        assertApproxEqRel(M.amount0Range(t, t + S, S, L, false), M.leg0(t, L, false), 1e9, "1-level amount0");
    }

    // ---- solvency: a split claim never pays more than the whole (no leak) ----
    function testTelescopingNoRoundingLeak() public pure {
        int24 a = 1000;
        int24 mid = 1050;
        int24 b = 1100;
        // payouts floor: floor(x)+floor(y) <= floor(x+y)
        uint256 whole1 = M.amount1Range(a, b, S, L, false);
        uint256 split1 = M.amount1Range(a, mid, S, L, false) + M.amount1Range(mid, b, S, L, false);
        assertLe(split1, whole1, "token1 split <= whole");
        assertApproxEqAbs(split1, whole1, 4, "token1 split ~= whole");

        uint256 whole0 = M.amount0Range(a, b, S, L, false);
        uint256 split0 = M.amount0Range(a, mid, S, L, false) + M.amount0Range(mid, b, S, L, false);
        assertLe(split0, whole0, "token0 split <= whole");
        assertApproxEqAbs(split0, whole0, 4, "token0 split ~= whole");

        // deposits ceil: the book pulls at least what splits would owe
        uint256 wholeDep = M.amount1Range(a, b, S, L, true);
        uint256 splitDep = M.amount1Range(a, mid, S, L, true) + M.amount1Range(mid, b, S, L, true);
        assertGe(splitDep, wholeDep, "ceil deposit covers");
    }

    // ---- O(1): the range amount is closed-form, flat in width ----
    function testAmountsAreWidthIndependent() public view {
        int24 lo = 1000;
        uint256 g0 = gasleft();
        M.amount1Range(lo, lo + 100, S, L, true);
        uint256 narrow = g0 - gasleft();
        g0 = gasleft();
        M.amount1Range(lo, lo + 100000, S, L, true);
        uint256 wide = g0 - gasleft();
        console2.log("amount1Range gas narrow(100)/wide(100000):", narrow, wide);
        // closed form does exactly 3 sqrtP calls regardless of width; the small
        // residual variance is isqrt cost at a larger upper-tick MAGNITUDE, not
        // width. O(width) would be ~1000x here (millions of gas), not ~1.3k.
        assertApproxEqAbs(narrow, wide, 2500, "amount1Range O(1) in width");
    }
}
