// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.24;

/// @title SqrtTickMath — sqrt(1.0001^tick) in X18 via binary exponentiation
///
/// The square-root sibling of GeoTickMath. sqrtP(t) = 1.0001^(t/2) = r^t with
/// r = sqrt(1.0001). Binary exp over r^(2^i) constants. The neat part: for bit
/// i >= 1 the constant r^(2^i) = 1.0001^(2^(i-1)) is EXACTLY GeoTickMath's bit
/// (i-1) constant, so the table is GeoTickMath's shifted up one bit, plus a
/// single new bottom constant r^1 = sqrt(1.0001).
///
/// Why this exists: the naive sqrtP via isqrt(pow * 1e18) costs ~13k gas (a
/// Babylonian loop) AND breaks exact telescoping, because an independent floor
/// per tick means sqrtP(t)*sqrtP(s) != sqrtP(t+s). Here, like the pow table,
/// every step floors against the SAME constants, so sqrtP is multiplicatively
/// consistent by construction: sqrtP(t)*sqrtP(s)/1e18 == sqrtP(t+s) (up to the
/// shared per-step floor that also appears in every span denominator). That
/// makes the geomean-L span closed form EXACT — no rounding-leak, same O(1) as
/// the pow book — for ~1/8th the gas of isqrt.
library SqrtTickMath {
    uint256 internal constant X = 1e18;
    int24 internal constant MAX_TICK = 200_000;

    /// @dev sqrt(1.0001) in X18, floor. Bottom constant of the sqrt table.
    uint256 internal constant SQRT_1_0001 = 1000049998750062496;

    /// @dev sqrtP(t) = 1.0001^(t/2), X18, floor-rounded per step.
    function sqrtPowX18(int24 tick) internal pure returns (uint256 p) {
        unchecked {
            uint256 a = uint256(uint24(tick < 0 ? -tick : tick));
            require(a <= uint256(uint24(MAX_TICK)), "tick out of range");
            p = X;
            if (a & 0x1 != 0) p = (p * SQRT_1_0001) / X; //                r^1   = 1.0001^0.5
            if (a & 0x2 != 0) p = (p * 1000100000000000000) / X; //        r^2   = 1.0001^1
            if (a & 0x4 != 0) p = (p * 1000200010000000000) / X; //        r^4   = 1.0001^2
            if (a & 0x8 != 0) p = (p * 1000400060004000100) / X; //        r^8   = 1.0001^4
            if (a & 0x10 != 0) p = (p * 1000800280056007000) / X; //       r^16  = 1.0001^8
            if (a & 0x20 != 0) p = (p * 1001601200560182043) / X; //       r^32  = 1.0001^16
            if (a & 0x40 != 0) p = (p * 1003204964963598014) / X; //       r^64  = 1.0001^32
            if (a & 0x80 != 0) p = (p * 1006420201727613920) / X; //       r^128 = 1.0001^64
            if (a & 0x100 != 0) p = (p * 1012881622445451097) / X; //      ...   = 1.0001^128
            if (a & 0x200 != 0) p = (p * 1025929181087729343) / X;
            if (a & 0x400 != 0) p = (p * 1052530684607338948) / X;
            if (a & 0x800 != 0) p = (p * 1107820842039993613) / X;
            if (a & 0x1000 != 0) p = (p * 1227267018058200482) / X;
            if (a & 0x2000 != 0) p = (p * 1506184333613467388) / X;
            if (a & 0x4000 != 0) p = (p * 2268591246822644826) / X;
            if (a & 0x8000 != 0) p = (p * 5146506245160322222) / X;
            if (a & 0x10000 != 0) p = (p * 26486526531474198664) / X;
            if (a & 0x20000 != 0) p = (p * 701536087702486644953) / X; //  r^(2^17) = 1.0001^65536
            if (tick < 0) p = (X * X) / p;
        }
    }
}
