// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {SqrtLiquidityMath as M} from "../src/sqrt/SqrtLiquidityMath.sol";
import {SqrtTickLiquidityMath as MT} from "../src/sqrt/SqrtTickLiquidityMath.sol";
import {SqrtTickMath} from "../src/sqrt/SqrtTickMath.sol";
import {GeoTickMath} from "../src/curve/GeoTickMath.sol";

/// @notice Isolates the per-deposit AMOUNT MATH of each candidate book shape.
/// Book-level cost (position SSTORE, two ERC20 transfers, bitmap delta) is
/// identical across all shapes, so the amount math is the only differentiator.
/// We measure each primitive's marginal gas with gasleft() bracketing, calling
/// through a non-inlinable boundary so the optimizer can't fold it away.
contract SqrtShapeBench is Test {
    uint128 internal constant L = 1e18;
    int24 internal constant S = 1;

    // --- production geometric span (powX18 only, no sqrt) ---
    // L * (P(b) - P(a)) / (P(s) - 1e18) — one pow per endpoint.
    function geoSpan(int24 a, int24 b, uint128 l, bool up) public pure returns (uint256) {
        uint256 d = GeoTickMath.powX18(S) - 1e18;
        uint256 num = uint256(l) * (GeoTickMath.powX18(b) - GeoTickMath.powX18(a));
        return up ? (num + d - 1) / d : num / d;
    }

    // --- production ask principal: flat token0, pure multiply ---
    function countMul(int24 a, int24 b, uint128 l) public pure returns (uint256) {
        return uint256(l) * uint256(uint24((b - a) / S));
    }

    // --- sqrt geomean span (isqrt-based) ---
    function sqrtSpan0(int24 a, int24 b, uint128 l, bool up) public pure returns (uint256) {
        return M.amount0Range(a, b, S, l, up);
    }

    function sqrtSpan1(int24 a, int24 b, uint128 l, bool up) public pure returns (uint256) {
        return M.amount1Range(a, b, S, l, up);
    }

    // --- sqrt geomean span on the TABLE (no isqrt) ---
    function tabSpan0(int24 a, int24 b, uint128 l, bool up) public pure returns (uint256) {
        return MT.amount0Range(a, b, S, l, up);
    }

    function tabSpan1(int24 a, int24 b, uint128 l, bool up) public pure returns (uint256) {
        return MT.amount1Range(a, b, S, l, up);
    }

    function sqrtTabOnly(int24 t) public pure returns (uint256) {
        return SqrtTickMath.sqrtPowX18(t);
    }

    // --- raw primitives ---
    function powOnly(int24 t) public pure returns (uint256) {
        return GeoTickMath.powX18(t);
    }

    function sqrtOnly(int24 t) public pure returns (uint256) {
        return M.sqrtPriceX18(t);
    }

    function measure(string memory label, function(int24, int24, uint128, bool) external pure returns (uint256) f)
        internal
        view
    {
        int24 a = 1000;
        int24 b = 1100;
        uint256 g = gasleft();
        f(a, b, L, true);
        uint256 cost = g - gasleft();
        console2.log(label, cost);
    }

    function testShapeAmountMathGas() public view {
        console2.log("--- per-deposit amount math (gas, incl. external-call overhead ~700) ---");
        // production ask: flat token0, pure multiply
        uint256 g = gasleft();
        this.countMul(1000, 1100, L);
        console2.log("A production ASK  count*L      :", g - gasleft());
        // production bid: one geometric span
        measure("A production BID  geoSpan       :", this.geoSpan);
        // sqrt symmetric: both legs are isqrt spans
        measure("B sqrt isqrt      amount0Range  :", this.sqrtSpan0);
        measure("B sqrt isqrt      amount1Range  :", this.sqrtSpan1);
        // C: symmetric on the sqrt TABLE (no isqrt) — the fair fight
        measure("C sqrt TABLE      amount0Range  :", this.tabSpan0);
        measure("C sqrt TABLE      amount1Range  :", this.tabSpan1);

        console2.log("--- raw price primitives at tick 1100 ---");
        g = gasleft();
        this.powOnly(1100);
        console2.log("powX18(t)   (binary exp, geo) :", g - gasleft());
        g = gasleft();
        this.sqrtTabOnly(1100);
        console2.log("sqrtPowX18(t) (table)         :", g - gasleft());
        g = gasleft();
        this.sqrtOnly(1100);
        console2.log("sqrtPriceX18(t) (pow+isqrt)   :", g - gasleft());

        console2.log("--- raw primitives at tick 150000 (deep, isqrt iterates more) ---");
        g = gasleft();
        this.powOnly(150000);
        console2.log("powX18(150000)                :", g - gasleft());
        g = gasleft();
        this.sqrtOnly(150000);
        console2.log("sqrtPriceX18(150000)          :", g - gasleft());
    }
}
