// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {RollingFrontierBook} from "../RollingFrontierBook.sol";

/// @title FrontierLens — read-only periphery for UIs, bots, and aggregators.
/// Reconstructs book depth from the public ledgers and quotes swaps by
/// replaying the sweep math off-chain (eth_call), without touching state.
contract FrontierLens {
    uint256 internal constant PRICE_SCALE = 1e18;

    struct Level {
        int24 tick;
        uint128 askSize; // token0 resting at this level
        uint128 bidSize; // token0-denominated bid size at this level
    }

    struct BookSummary {
        int24 currentTick;
        int24 tickSpacing;
        address token0;
        address token1;
        int24 bestAsk; // lowest live ask level (type(int24).max if none)
        int24 bestBid; // highest live bid level (type(int24).min if none)
    }

    /// @notice Depth over [fromTick, toTick): walks the aggregate ledgers
    /// once and emits non-empty levels only. View-only; intended for
    /// eth_call from UIs (bounded by the requested window).
    function depth(RollingFrontierBook book, int24 fromTick, int24 toTick, uint256 maxLevels)
        external
        view
        returns (Level[] memory levels)
    {
        int24 s = book.tickSpacing();
        Level[] memory buf = new Level[](maxLevels);
        uint256 n;

        // ask side: prefix-sum of value+slope ledgers from below
        {
            int256 acc;
            int256 slope;
            // start the prefix far enough below to capture rolled state
            int24 start = fromTick - s * 512;
            for (int24 t = start; t < toTick && n < maxLevels; t += s) {
                slope += book.frontierSlope(t);
                acc += book.frontierDelta(t) + slope;
                if (t >= fromTick && acc > 0) {
                    buf[n] = Level({tick: t, askSize: uint128(uint256(acc)), bidSize: 0});
                    n++;
                }
            }
        }
        // bid side: suffix-sum from above
        {
            int256 acc;
            int24 start = toTick + s * 512;
            uint256 firstBid = n;
            for (int24 t = start; t >= fromTick; t -= s) {
                acc += book.bidDelta(t);
                if (t < toTick && acc > 0 && n < maxLevels) {
                    // merge into existing ask entry if same tick
                    bool merged;
                    for (uint256 i = 0; i < firstBid; i++) {
                        if (buf[i].tick == t) {
                            buf[i].bidSize = uint128(uint256(acc));
                            merged = true;
                            break;
                        }
                    }
                    if (!merged) {
                        buf[n] = Level({tick: t, askSize: 0, bidSize: uint128(uint256(acc))});
                        n++;
                    }
                }
            }
        }

        levels = new Level[](n);
        for (uint256 i = 0; i < n; i++) {
            levels[i] = buf[i];
        }
    }

    function summary(RollingFrontierBook book, int24 scanWindow) external view returns (BookSummary memory out) {
        out.currentTick = book.currentTick();
        out.tickSpacing = book.tickSpacing();
        out.token0 = address(book.token0());
        out.token1 = address(book.token1());
        out.bestAsk = type(int24).max;
        out.bestBid = type(int24).min;

        int24 s = out.tickSpacing;
        int256 acc;
        int256 slope;
        for (int24 t = out.currentTick - scanWindow; t <= out.currentTick + scanWindow; t += s) {
            slope += book.frontierSlope(t);
            acc += book.frontierDelta(t) + slope;
            if (t > out.currentTick && acc > 0 && out.bestAsk == type(int24).max) {
                out.bestAsk = t;
            }
        }
        int256 bacc;
        for (int24 t = out.currentTick + scanWindow; t >= out.currentTick - scanWindow; t -= s) {
            bacc += book.bidDelta(t);
            if (t <= out.currentTick - s && bacc > 0) {
                out.bestBid = t;
                break;
            }
        }
    }

    /// @notice Exact-input BUY quote (token1 in, token0 out): replays the
    /// endpoint-telescoped up-sweep read-only, including the mid-run budget
    /// subdivision, so the quote matches execution to the wei.
    function quoteBuy(RollingFrontierBook book, uint256 amount1In)
        external
        view
        returns (uint256 amount0Out, uint256 amount1Spent, int24 endTick)
    {
        int24 s = book.tickSpacing();
        int24 cur = book.currentTick();
        int24 lastLevel = _maxTick(s) - s;

        int256 B;
        int256 S;
        endTick = cur;

        (int24 e, bool found) = _nextActiveAsk(book, _nextBoundaryAbove(cur, s) - s, lastLevel, s);
        while (found) {
            (int24 e2, bool found2) = _nextActiveAsk(book, e + s, lastLevel, s);
            int24 runEnd = found2 ? e2 : e; // no further endpoint: run is just the tail at e..? handled below
            if (!found2) runEnd = lastLevel + s;

            int256 S2 = S + book.frontierSlope(e);
            int256 a0 = B + book.frontierDelta(e) + S2;
            uint256 n = uint256(uint24(runEnd - e)) / uint256(uint24(s));
            if (a0 < 0) break; // defensive

            (uint256 out0, uint256 cost1) = _runAmounts(e, a0, S2, n, s);
            if (amount1Spent + cost1 > amount1In) {
                uint256 fit = _maxAffordable(e, a0, S2, n, amount1In - amount1Spent, s);
                if (fit > 0) {
                    (uint256 fo0, uint256 fc1) = _runAmounts(e, a0, S2, fit, s);
                    amount0Out += fo0;
                    amount1Spent += fc1;
                    endTick = e + int24(uint24(fit)) * s;
                } else {
                    endTick = e;
                }
                return (amount0Out, amount1Spent, endTick);
            }
            amount0Out += out0;
            amount1Spent += cost1;
            endTick = runEnd;
            B = a0 + int256(n - 1) * S2;
            S = S2;
            e = e2;
            found = found2;
        }
    }

    /// @notice Exact-input SELL quote (token0 in, token1 out): replays the
    /// per-level bid walk read-only, simulating the downward roll (deltas
    /// accumulate walking down; gaps jump via the bid bitmap). Bounded by
    /// maxLevels; matches execution to the wei (per-level floor payouts).
    function quoteSell(RollingFrontierBook book, uint256 amount0In, uint256 maxLevels)
        external
        view
        returns (uint256 amount1Out, uint256 amount0Spent, int24 endTick)
    {
        int24 s = book.tickSpacing();
        int24 cur = book.currentTick();
        endTick = cur;
        int256 acc;
        int24 l = _floorAligned(cur - 1, s);
        for (uint256 i = 0; i < maxLevels; i++) {
            acc += book.bidDelta(l);
            if (acc <= 0) {
                // gap (or exhausted): jump to the next set bit below
                (int24 nxt, bool found) = _prevActiveBid(book, l - s, s);
                if (!found) break;
                l = nxt;
                continue;
            }
            uint256 size = uint256(acc);
            if (amount0Spent + size > amount0In) {
                endTick = l + s;
                return (amount1Out, amount0Spent, endTick);
            }
            amount0Spent += size;
            amount1Out += (size * _rate(l)) / PRICE_SCALE;
            endTick = l;
            l -= s;
        }
    }

    // ------------------------------------------------------------------
    // internals (mirror the book's math/bitmap walks, read-only)
    // ------------------------------------------------------------------

    function _rate(int24 t) internal pure returns (uint256) {
        int256 r = int256(PRICE_SCALE) + int256(t) * 1e15;
        require(r > 0, "rate underflow");
        return uint256(r);
    }

    function _runAmounts(int24 e, int256 a0, int256 slope, uint256 n, int24 s)
        internal
        pure
        returns (uint256 out0, uint256 cost1)
    {
        int256 ni = int256(n);
        int256 sumK = (ni * (ni - 1)) / 2;
        int256 sumK2 = ((ni - 1) * ni * (2 * ni - 1)) / 6;
        int256 tot0 = a0 * ni + slope * sumK;
        int256 c0 = int256(PRICE_SCALE) + int256(e) * 1e15;
        int256 c1 = int256(s) * 1e15;
        int256 val = a0 * c0 * ni + (a0 * c1 + slope * c0) * sumK + slope * c1 * sumK2;
        if (tot0 < 0 || val < 0) return (0, 0);
        out0 = uint256(tot0);
        cost1 = (uint256(val) + PRICE_SCALE - 1) / PRICE_SCALE;
    }

    function _maxAffordable(int24 e, int256 a0, int256 slope, uint256 n, uint256 budget, int24 s)
        internal
        pure
        returns (uint256 m)
    {
        uint256 lo = 0;
        uint256 hi = n;
        while (lo < hi) {
            uint256 mid = (lo + hi + 1) / 2;
            (, uint256 c) = _runAmounts(e, a0, slope, mid, s);
            if (c <= budget) lo = mid;
            else hi = mid - 1;
        }
        return lo;
    }

    function _nextActiveAsk(RollingFrontierBook book, int24 fromT, int24 maxT, int24 s)
        internal
        view
        returns (int24, bool)
    {
        if (fromT > maxT) return (0, false);
        int24 c = fromT / s;
        int24 cMax = maxT / s;
        while (c <= cMax) {
            int16 wordPos = int16(c >> 8);
            uint8 bitPos = uint8(uint24(c));
            uint256 word = book.tickBitmap(wordPos) >> bitPos;
            if (word != 0) {
                int24 cFound = c + int24(uint24(_lsb(word)));
                if (cFound > cMax) return (0, false);
                return (cFound * s, true);
            }
            c = (int24(wordPos) + 1) * 256;
        }
        return (0, false);
    }

    function _prevActiveBid(RollingFrontierBook book, int24 fromT, int24 s) internal view returns (int24, bool) {
        int24 c = fromT / s;
        int24 cMin = c - 4096; // bounded scan window for quoting
        while (c >= cMin) {
            int16 wordPos = int16(c >> 8);
            uint8 bitPos = uint8(uint24(c));
            uint256 word = book.bidBitmap(wordPos) << (255 - bitPos);
            if (word != 0) {
                int24 cFound = c - int24(uint24(255 - _msb(word)));
                return (cFound * s, true);
            }
            c = (int24(wordPos) * 256) - 1;
        }
        return (0, false);
    }

    function _lsb(uint256 x) private pure returns (uint8 r) {
        if (x & type(uint128).max == 0) {
            r += 128;
            x >>= 128;
        }
        if (x & type(uint64).max == 0) {
            r += 64;
            x >>= 64;
        }
        if (x & type(uint32).max == 0) {
            r += 32;
            x >>= 32;
        }
        if (x & type(uint16).max == 0) {
            r += 16;
            x >>= 16;
        }
        if (x & type(uint8).max == 0) {
            r += 8;
            x >>= 8;
        }
        if (x & 0xF == 0) {
            r += 4;
            x >>= 4;
        }
        if (x & 0x3 == 0) {
            r += 2;
            x >>= 2;
        }
        if (x & 0x1 == 0) {
            r += 1;
        }
    }

    function _msb(uint256 x) private pure returns (uint8 r) {
        if (x >> 128 != 0) {
            r += 128;
            x >>= 128;
        }
        if (x >> 64 != 0) {
            r += 64;
            x >>= 64;
        }
        if (x >> 32 != 0) {
            r += 32;
            x >>= 32;
        }
        if (x >> 16 != 0) {
            r += 16;
            x >>= 16;
        }
        if (x >> 8 != 0) {
            r += 8;
            x >>= 8;
        }
        if (x >> 4 != 0) {
            r += 4;
            x >>= 4;
        }
        if (x >> 2 != 0) {
            r += 2;
            x >>= 2;
        }
        if (x >> 1 != 0) {
            r += 1;
        }
    }

    function _nextBoundaryAbove(int24 tick, int24 s) internal pure returns (int24) {
        int24 b = (tick / s) * s;
        if (b <= tick) b += s;
        return b;
    }

    function _floorAligned(int24 x, int24 s) internal pure returns (int24) {
        int24 q = x / s;
        if (x < 0 && x % s != 0) q -= 1;
        return q * s;
    }

    function _maxTick(int24 s) internal pure returns (int24) {
        return (int24(8388000) / s) * s;
    }
}
