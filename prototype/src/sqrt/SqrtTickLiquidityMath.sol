// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {SqrtTickMath as T} from "./SqrtTickMath.sol";

/// @title SqrtTickLiquidityMath — currency-neutral L-sizing on the sqrt TABLE
///
/// Identical contract to SqrtLiquidityMath, but every sqrtP comes from the
/// binary-exp table (SqrtTickMath) instead of isqrt(pow). Two consequences:
///   1. ~1/8th the gas (no Babylonian loop).
///   2. EXACT telescoping: because sqrtP(t+s) = sqrtP(t)*sqrtP(s)/1e18 holds by
///      construction (shared per-step floors), the single-level closed form
///      equals the leg, and split spans equal the whole to the last wei — the
///      same airtight solvency the pow book enjoys, now on the geomean curve.
///
/// A position is (tickLower, tickUpper, L), L = sqrt(amount0*amount1). An ASK
/// escrows the token0 leg L/sqrtP; a BID escrows the token1 leg L*sqrtP. The
/// bid is the ask reflected: leg0(t) == leg1(-t).
library SqrtTickLiquidityMath {
    uint256 internal constant X = 1e18;

    function sqrtPriceX18(int24 tick) internal pure returns (uint256) {
        return T.sqrtPowX18(tick);
    }

    function invSqrtPriceX18(int24 tick) internal pure returns (uint256) {
        return T.sqrtPowX18(-tick); // exact reciprocal of the table value
    }

    /// @dev token0 leg of L at level t: L / sqrtP(t).
    function leg0(int24 tick, uint128 L, bool roundUp) internal pure returns (uint256) {
        uint256 num = uint256(L) * X;
        uint256 d = sqrtPriceX18(tick);
        return roundUp ? (num + d - 1) / d : num / d;
    }

    /// @dev token1 leg of L at level t: L * sqrtP(t).
    function leg1(int24 tick, uint128 L, bool roundUp) internal pure returns (uint256) {
        uint256 num = uint256(L) * sqrtPriceX18(tick);
        return roundUp ? (num + X - 1) / X : num / X;
    }

    /// @dev token0 for a uniform-L ask over [lower, upper):
    /// L * sum 1/sqrtP(t) = L*(invS(lower)-invS(upper))*sqrtP(s)/(1e18*(sqrtP(s)-1e18)).
    function amount0Range(int24 lower, int24 upper, int24 spacing, uint128 L, bool roundUp)
        internal
        pure
        returns (uint256)
    {
        if (upper <= lower) return 0;
        uint256 sSpace = sqrtPriceX18(spacing);
        uint256 d1 = sSpace - X;
        uint256 num = uint256(L) * (invSqrtPriceX18(lower) - invSqrtPriceX18(upper)) * sSpace;
        uint256 den = X * d1;
        return roundUp ? (num + den - 1) / den : num / den;
    }

    /// @dev token1 for a uniform-L bid over [lower, upper):
    /// L * sum sqrtP(t) = L*(sqrtP(upper)-sqrtP(lower))/(sqrtP(s)-1e18).
    function amount1Range(int24 lower, int24 upper, int24 spacing, uint128 L, bool roundUp)
        internal
        pure
        returns (uint256)
    {
        if (upper <= lower) return 0;
        uint256 d1 = sqrtPriceX18(spacing) - X;
        uint256 num = uint256(L) * (sqrtPriceX18(upper) - sqrtPriceX18(lower));
        return roundUp ? (num + d1 - 1) / d1 : num / d1;
    }
}
