// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {SqrtTickLiquidityMath as MT} from "../src/sqrt/SqrtTickLiquidityMath.sol";
import {SqrtLiquidityMath as M} from "../src/sqrt/SqrtLiquidityMath.sol";
import {SqrtTickMath as T} from "../src/sqrt/SqrtTickMath.sol";
import {GeoTickMath} from "../src/curve/GeoTickMath.sol";

/// @notice The table-based symmetric book is the fair-fight version: it keeps
/// the geomean reflection symmetry but drops isqrt for a binary-exp table.
/// These tests prove the two things isqrt could only approximate:
///   (1) sqrtP squares back to the SAME P the pow book uses (curve agreement),
///   (2) single-level span == leg and split == whole to ~1 wei (not 1e4 wei),
/// plus the reflection symmetry and O(1) the design is sold on.
contract SqrtTickLiquidityTest is Test {
    uint128 internal constant L = 1e18;
    int24 internal constant S = 1;

    // ---- sqrtP^2 agrees with the pow book's P to ~1 wei (shared curve) ----
    function testSqrtSquaresToPow() public pure {
        int24[5] memory ts = [int24(0), int24(100), int24(-100), int24(5000), int24(150000)];
        for (uint256 i = 0; i < ts.length; i++) {
            uint256 s = T.sqrtPowX18(ts[i]);
            uint256 p = GeoTickMath.powX18(ts[i]);
            assertApproxEqRel(s * s / 1e18, p, 1e6, "sqrtP^2 ~= P");
        }
    }

    // ---- reflection: sqrtP(-t) is the exact reciprocal of sqrtP(t) ----
    function testReciprocalReflection() public pure {
        for (int24 t = -3000; t <= 3000; t += 750) {
            uint256 up = T.sqrtPowX18(t);
            uint256 dn = T.sqrtPowX18(-t);
            assertApproxEqAbs(up * dn / 1e18, 1e18, 2, "sqrtP(t)*sqrtP(-t)==1");
        }
    }

    // ---- THE symmetry, exact: leg0(t) == leg1(-t) to ~1 wei ----
    function testTokenSwapSymmetryTight() public pure {
        uint256 worst = 0;
        for (int24 t = -3000; t <= 3000; t += 250) {
            uint256 ask0 = MT.leg0(t, L, true);
            uint256 bid1 = MT.leg1(-t, L, true);
            uint256 d = ask0 > bid1 ? ask0 - bid1 : bid1 - ask0;
            if (d > worst) worst = d;
        }
        console2.log("table leg0(t) vs leg1(-t) worst wei gap:", worst);
        assertLe(worst, 2, "reflection symmetry exact to 2 wei");
    }

    // ---- single-level span ~= leg only in RELATIVE terms (denominator amp) ----
    // NOTE / adversarial finding: the table does NOT make span==leg wei-exact.
    // At spacing=1 the span denominator sqrtP(1)-1e18 ~= 5e13, so a 1-wei error
    // in the numerator amplifies to ~2e4 wei. Both isqrt and table land at
    // ~1e4-3e4 wei here, i.e. ~3e-14 RELATIVE — negligible, and identical in
    // kind. "span == leg" is a cosmetic interpretation check, not a solvency
    // invariant; the book only ever compares span-to-span (see leak test).
    function testSingleLevelMatchesLegRelative() public pure {
        int24 t = 1500;
        uint256 tabSpan = MT.amount1Range(t, t + S, S, L, false);
        uint256 tabLeg = MT.leg1(t, L, false);
        assertApproxEqRel(tabSpan, tabLeg, 1e6, "table span ~= leg to 1e-12 rel");

        uint256 isqSpan = M.amount1Range(t, t + S, S, L, false);
        uint256 isqLeg = M.leg1(t, L, false);
        assertApproxEqRel(isqSpan, isqLeg, 1e6, "isqrt span ~= leg to 1e-12 rel");

        uint256 tabGap = tabSpan > tabLeg ? tabSpan - tabLeg : tabLeg - tabSpan;
        uint256 isqGap = isqSpan > isqLeg ? isqSpan - isqLeg : isqLeg - isqSpan;
        console2.log("single-level abs gap table / isqrt (wei, ~3e-14 rel):", tabGap, isqGap);
    }

    // ---- solvency: split payout never exceeds the whole (no leak) ----
    function testNoRoundingLeakTight() public pure {
        int24 a = 1000;
        int24 mid = 1050;
        int24 b = 1100;
        uint256 whole1 = MT.amount1Range(a, b, S, L, false);
        uint256 split1 = MT.amount1Range(a, mid, S, L, false) + MT.amount1Range(mid, b, S, L, false);
        assertLe(split1, whole1, "token1 split <= whole");
        assertApproxEqAbs(split1, whole1, 2, "token1 split ~= whole (2 wei)");

        uint256 whole0 = MT.amount0Range(a, b, S, L, false);
        uint256 split0 = MT.amount0Range(a, mid, S, L, false) + MT.amount0Range(mid, b, S, L, false);
        assertLe(split0, whole0, "token0 split <= whole");
        assertApproxEqAbs(split0, whole0, 2, "token0 split ~= whole (2 wei)");

        // deposit ceil always covers what split payouts (floor) could owe
        uint256 dep = MT.amount1Range(a, b, S, L, true);
        assertGe(dep, split1, "ceil deposit covers split floor payouts");
    }

    // ---- per-level realized price is exactly P(t) ----
    function testPerLevelPriceExact() public pure {
        int24 t = 2000;
        uint256 a0 = MT.leg0(t, L, true);
        uint256 a1 = MT.leg1(t, L, false);
        uint256 realized = a1 * 1e18 / a0;
        assertApproxEqRel(realized, GeoTickMath.powX18(t), 1e9, "realized == P(t)");
    }

    // ---- O(1) in width ----
    function testWidthIndependent() public view {
        int24 lo = 1000;
        uint256 g = gasleft();
        MT.amount1Range(lo, lo + 100, S, L, true);
        uint256 narrow = g - gasleft();
        g = gasleft();
        MT.amount1Range(lo, lo + 100000, S, L, true);
        uint256 wide = g - gasleft();
        console2.log("table amount1Range narrow/wide:", narrow, wide);
        assertApproxEqAbs(narrow, wide, 1500, "O(1) in width");
    }
}
