// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {GeoTickMath} from "../curve/GeoTickMath.sol";

/// @title SqrtLiquidityMath — currency-neutral position sizing
///
/// A position is `(tickLower, tickUpper, L)`. Size `L` is the geometric-mean
/// unit `L = sqrt(amount0 * amount1)`; neither token is the numeraire. Each
/// discrete level `t` is ONE exact price `P(t) = 1.0001^t` (token1 per
/// token0), and a unit of L parked there is the v3 boundary case collapsed to
/// a point:
///
///     amount0(t) = L / sqrtP(t)      amount1(t) = L * sqrtP(t)
///     => amount0 * amount1 = L^2,  amount1 / amount0 = P(t)   (exact fill price)
///
/// So an ASK (resting above price) escrows the token0 leg `L/sqrtP`; a BID
/// (resting below price) escrows the token1 leg `L*sqrtP`. The SAME L on either
/// side is the same depth, and swapping token0<->token1 sends `t -> -t` and
/// swaps the two legs with L unchanged — the bid is the ask, reflected.
///
/// A uniform-L range telescopes to a closed form (O(1) in width): because
/// sqrtP(t+s) = sqrtP(t)*sqrtP(s), the discrete level sum collapses exactly,
/// e.g. sum over one level reduces to L*sqrtP(t). All values are differences of
/// sqrtP endpoints over a shared per-book denominator, so partial claims
/// telescope against deposits the same way the geometric value book does.
library SqrtLiquidityMath {
    uint256 internal constant X = 1e18;

    /// @dev integer sqrt (Babylonian), floor.
    function isqrt(uint256 n) internal pure returns (uint256 r) {
        if (n == 0) return 0;
        uint256 x = n;
        r = (x >> 1) + 1;
        uint256 y = (r + x / r) >> 1;
        while (y < r) {
            r = y;
            y = (r + x / r) >> 1;
        }
    }

    /// @dev sqrtP(t) in X18 = sqrt(1.0001^t) * 1e18.
    function sqrtPriceX18(int24 tick) internal pure returns (uint256) {
        return isqrt(GeoTickMath.powX18(tick) * X);
    }

    /// @dev 1/sqrtP(t) in X18.
    function invSqrtPriceX18(int24 tick) internal pure returns (uint256) {
        return (X * X) / sqrtPriceX18(tick);
    }

    // ------------------------------------------------------------------
    // Single level (one exact price point)
    // ------------------------------------------------------------------

    /// @dev token0 leg of L at level `t`: L / sqrtP(t).
    function leg0(int24 tick, uint128 L, bool roundUp) internal pure returns (uint256) {
        uint256 num = uint256(L) * X;
        uint256 d = sqrtPriceX18(tick);
        return roundUp ? (num + d - 1) / d : num / d;
    }

    /// @dev token1 leg of L at level `t`: L * sqrtP(t).
    function leg1(int24 tick, uint128 L, bool roundUp) internal pure returns (uint256) {
        uint256 num = uint256(L) * sqrtPriceX18(tick);
        return roundUp ? (num + X - 1) / X : num / X;
    }

    // ------------------------------------------------------------------
    // Uniform-L range [lower, upper), levels stepping `spacing` (O(1))
    // ------------------------------------------------------------------

    /// @dev token0 to fund a uniform-L ask over [lower, upper):
    /// L * sum_{t} 1/sqrtP(t) = L*(invS(lower)-invS(upper))*sqrtP(spacing)/(1e18*D1),
    /// D1 = sqrtP(spacing) - 1e18. roundUp = book-favorable for deposits.
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

    /// @dev token1 to fund a uniform-L bid over [lower, upper):
    /// L * sum_{t} sqrtP(t) = L*(sqrtP(upper)-sqrtP(lower))/D1.
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
