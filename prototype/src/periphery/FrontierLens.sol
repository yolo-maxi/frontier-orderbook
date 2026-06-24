// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.24;

import {FrontierBookBase} from "../FrontierBookBase.sol";
import {IRangeOrderBook} from "../IRangeOrderBook.sol";
import {GeoTickMath} from "../curve/GeoTickMath.sol";

/// @dev The book's public position/frontier views used by the lens snapshots.
interface IFrontierBookViews {
    function positions(uint256 positionId)
        external
        view
        returns (
            address owner,
            int24 lower,
            int24 upper,
            uint128 liquidity,
            uint64 depositClock,
            int24 claimedUpper,
            bool live,
            bool isBid
        );
    function frontierOf(uint256 positionId) external view returns (int24);
    function bidFrontierOf(uint256 positionId) external view returns (int24);
    function claimable(uint256 positionId) external view returns (uint256);
    function bidClaimable(uint256 positionId) external view returns (uint256);
    function unfilledPrincipal(uint256 positionId) external view returns (uint256);
    function bidRefundable(uint256 positionId) external view returns (uint256);
    function nextPositionId() external view returns (uint256);
}

/// @title FrontierLens — read-only periphery for UIs, bots, and aggregators.
/// Reconstructs book depth from the public ledgers and quotes swaps by
/// replaying the sweep math off-chain (eth_call), without touching state.
///
/// CURVE-AWARE: a book is probed once per quote for `geoD()` — present on
/// `GeometricFrontierBook` (the production 1.0001^tick curve), absent on
/// the linear demo curve — and every span/price computation routes through
/// the matching closed form, with the book's exact rounding (taker pays
/// ceil, taker receives floor, per RUN, not per level). Quotes match
/// execution to the wei on both curves.
contract FrontierLens {
    uint256 internal constant PRICE_SCALE = 1e18;

    /// resolved once per quote; `d = P(tickSpacing) - 1e18` for geometric
    struct Curve {
        bool geo;
        uint256 d;
    }

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

    /// @notice Fully-resolved snapshot of a single position for indexers/UI,
    /// gathered in one eth_call so the client never reconstructs frontier
    /// state from raw ledgers.
    struct PositionView {
        uint256 positionId;
        address owner;
        int24 lower;
        int24 upper;
        uint128 liquidity;
        int24 claimedUpper;
        bool live;
        bool isBid;
        int24 frontier; // current fill frontier (ask: highest covered; bid: lowest)
        uint256 claimable; // net token proceeds harvestable right now
        uint256 unfilled; // principal still resting (token0 for asks, token1 refundable for bids)
    }

    /// @notice Depth over [fromTick, toTick): walks the aggregate ledgers
    /// once and emits non-empty levels only. View-only; intended for
    /// eth_call from UIs (bounded by the requested window).
    function depth(FrontierBookBase book, int24 fromTick, int24 toTick, uint256 maxLevels)
        external
        view
        returns (Level[] memory levels)
    {
        int24 s = book.tickSpacing();
        Level[] memory buf = new Level[](maxLevels);
        uint256 n;

        // ask side: prefix-sum of the value ledger from below
        {
            int256 acc;
            // start the prefix far enough below to capture rolled state
            int24 start = fromTick - s * 512;
            for (int24 t = start; t < toTick && n < maxLevels; t += s) {
                acc += book.frontierDelta(t);
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

    function summary(FrontierBookBase book, int24 scanWindow) external view returns (BookSummary memory out) {
        out.currentTick = IRangeOrderBook(address(book)).currentTick();
        out.tickSpacing = book.tickSpacing();
        out.token0 = address(book.token0());
        out.token1 = address(book.token1());
        out.bestAsk = type(int24).max;
        out.bestBid = type(int24).min;

        int24 s = out.tickSpacing;
        int256 acc;
        for (int24 t = out.currentTick - scanWindow; t <= out.currentTick + scanWindow; t += s) {
            acc += book.frontierDelta(t);
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

    /// @notice One fully-resolved position snapshot. Dead/zero ids return a
    /// zeroed view with `live == false`. Routes through the book's own
    /// frontier/claimable getters so the result matches what a claim would pay.
    function positionView(FrontierBookBase book, uint256 positionId) public view returns (PositionView memory v) {
        IFrontierBookViews b = IFrontierBookViews(address(book));
        (address owner, int24 lower, int24 upper, uint128 liquidity,, int24 claimedUpper, bool live, bool isBid) =
            b.positions(positionId);
        v.positionId = positionId;
        v.owner = owner;
        v.lower = lower;
        v.upper = upper;
        v.liquidity = liquidity;
        v.claimedUpper = claimedUpper;
        v.live = live;
        v.isBid = isBid;
        if (!live) return v;
        if (isBid) {
            v.frontier = b.bidFrontierOf(positionId);
            v.claimable = b.bidClaimable(positionId);
            v.unfilled = b.bidRefundable(positionId);
        } else {
            v.frontier = b.frontierOf(positionId);
            v.claimable = b.claimable(positionId);
            v.unfilled = b.unfilledPrincipal(positionId);
        }
    }

    /// @notice Batch position snapshots for an explicit id set — one round
    /// trip for an indexer or a maker's dashboard.
    function positionViews(FrontierBookBase book, uint256[] calldata positionIds)
        external
        view
        returns (PositionView[] memory views)
    {
        views = new PositionView[](positionIds.length);
        for (uint256 i = 0; i < positionIds.length; i++) {
            views[i] = positionView(book, positionIds[i]);
        }
    }

    /// @notice Every live position owned by `owner`, scanning ids in
    /// [fromId, toId). `toId == 0` means "up to nextPositionId()". Bounded by
    /// the caller's window so it stays an eth_call-only convenience.
    function positionsOf(FrontierBookBase book, address owner, uint256 fromId, uint256 toId)
        external
        view
        returns (PositionView[] memory views)
    {
        IFrontierBookViews b = IFrontierBookViews(address(book));
        if (toId == 0) toId = b.nextPositionId();
        if (fromId == 0) fromId = 1;
        PositionView[] memory buf = new PositionView[](toId > fromId ? toId - fromId : 0);
        uint256 n;
        for (uint256 id = fromId; id < toId; id++) {
            PositionView memory v = positionView(book, id);
            if (v.live && v.owner == owner) {
                buf[n] = v;
                n++;
            }
        }
        views = new PositionView[](n);
        for (uint256 i = 0; i < n; i++) {
            views[i] = buf[i];
        }
    }

    /// @notice Top-of-book: best ask/bid levels with their resting sizes and
    /// X18 rates, plus the absolute spread in ticks. A single call gives a UI
    /// everything it needs to render the inside market. `scanWindow` bounds the
    /// search either side of the current tick (eth_call only).
    struct TopOfBook {
        int24 currentTick;
        int24 bestAsk; // type(int24).max if no live ask in window
        uint128 bestAskSize; // token0 resting at bestAsk
        uint256 bestAskRate; // X18 token1/token0 at bestAsk (0 if none)
        int24 bestBid; // type(int24).min if no live bid in window
        uint128 bestBidSize; // token0-denominated size at bestBid
        uint256 bestBidRate; // X18 at bestBid (0 if none)
        int24 spreadTicks; // bestAsk - bestBid (type(int24).max if either side empty)
    }

    function bestPrices(FrontierBookBase book, int24 scanWindow) external view returns (TopOfBook memory out) {
        int24 s = book.tickSpacing();
        out.currentTick = IRangeOrderBook(address(book)).currentTick();
        out.bestAsk = type(int24).max;
        out.bestBid = type(int24).min;
        out.spreadTicks = type(int24).max;

        // ask side: prefix-sum the frontierDelta ledger from below the inside
        // market upward. The book is uniform — run size is constant across a run
        // and equals the running delta sum (no slope ladder) — so the first
        // level above the current tick with positive aggregate size is the best
        // ask. Mirrors summary()'s aggregation, just resolving size too.
        {
            int256 acc;
            int24 start = out.currentTick - s * 512;
            for (int24 t = start; t <= out.currentTick + scanWindow; t += s) {
                acc += book.frontierDelta(t);
                if (t > out.currentTick && acc > 0) {
                    out.bestAsk = t;
                    out.bestAskSize = uint128(uint256(acc));
                    break;
                }
            }
        }
        // bid side: suffix-sum from above; first level at/below price with
        // positive aggregate size is the best bid
        {
            int256 acc;
            for (int24 t = out.currentTick + scanWindow; t >= out.currentTick - scanWindow; t -= s) {
                acc += book.bidDelta(t);
                if (t <= out.currentTick - s && acc > 0) {
                    out.bestBid = t;
                    out.bestBidSize = uint128(uint256(acc));
                    break;
                }
            }
        }

        Curve memory c = curveOf(book);
        if (out.bestAsk != type(int24).max) out.bestAskRate = _rateAt(c, out.bestAsk, s);
        if (out.bestBid != type(int24).min) out.bestBidRate = _rateAt(c, out.bestBid, s);
        if (out.bestAsk != type(int24).max && out.bestBid != type(int24).min) {
            out.spreadTicks = out.bestAsk - out.bestBid;
        }
    }

    /// @dev X18 token1/token0 rate at a tick on the book's curve.
    function _rateAt(Curve memory c, int24 t, int24) internal pure returns (uint256) {
        if (c.geo) return GeoTickMath.powX18(t);
        int256 r = int256(PRICE_SCALE) + int256(t) * 1e15;
        return r > 0 ? uint256(r) : 0;
    }

    /// @notice The book's price curve, detected from the contract itself.
    function curveOf(FrontierBookBase book) public view returns (Curve memory c) {
        (bool ok, bytes memory ret) = address(book).staticcall(abi.encodeWithSignature("geoD()"));
        if (ok && ret.length >= 32) {
            c.d = abi.decode(ret, (uint256));
            c.geo = c.d > 0;
        }
    }

    /// @notice Exact-input BUY quote (token1 in, token0 out): replays the
    /// endpoint-telescoped up-sweep read-only, including the mid-run budget
    /// subdivision, so the quote matches execution to the wei.
    function quoteBuy(FrontierBookBase book, uint256 amount1In)
        external
        view
        returns (uint256 amount0Out, uint256 amount1Spent, int24 endTick)
    {
        Curve memory c = curveOf(book);
        uint16 takerFeeBps = book.takerFeeBps();
        uint256 grossBudget = _maxGrossForTotal(amount1In, takerFeeBps);
        int24 s = book.tickSpacing();
        int24 cur = IRangeOrderBook(address(book)).currentTick();
        int24 lastLevel = _maxTick(c, s) - s;

        int256 B;
        endTick = cur;

        (int24 e, bool found) = _nextActiveAsk(book, _nextBoundaryAbove(cur, s) - s, lastLevel, s);
        while (found) {
            (int24 e2, bool found2) = _nextActiveAsk(book, e + s, lastLevel, s);
            int24 runEnd = found2 ? e2 : e; // no further endpoint: run is just the tail at e..? handled below
            if (!found2) runEnd = lastLevel + s;

            int256 a0 = B + book.frontierDelta(e);
            uint256 n = uint256(uint24(runEnd - e)) / uint256(uint24(s));
            if (a0 < 0) break; // defensive

            (uint256 out0, uint256 cost1) = _runAmounts(c, e, a0, n, s);
            if (amount1Spent + cost1 > grossBudget) {
                uint256 fit = _maxAffordable(c, e, a0, n, grossBudget - amount1Spent, s);
                if (fit > 0) {
                    (uint256 fo0, uint256 fc1) = _runAmounts(c, e, a0, fit, s);
                    amount0Out += fo0;
                    amount1Spent += fc1;
                    endTick = e + int24(uint24(fit)) * s;
                } else {
                    endTick = e;
                }
                amount1Spent += _feeAmount(amount1Spent, takerFeeBps);
                return (amount0Out, amount1Spent, endTick);
            }
            amount0Out += out0;
            amount1Spent += cost1;
            endTick = runEnd;
            B = a0;
            e = e2;
            found = found2;
        }
        amount1Spent += _feeAmount(amount1Spent, takerFeeBps);
        return (amount0Out, amount1Spent, endTick);
    }

    /// @notice Exact-input SELL quote (token0 in, token1 out): replays the
    /// endpoint-telescoped down-sweep read-only — whole uniform runs settle
    /// with one closed form and the book's per-run floor, so the quote
    /// matches execution to the wei on both curves. `maxRuns` bounds the
    /// walk by maker-order endpoints (not price levels); endTick is the
    /// lowest filled level.
    function quoteSell(FrontierBookBase book, uint256 amount0In, uint256 maxRuns)
        external
        view
        returns (uint256 amount1Out, uint256 amount0Spent, int24 endTick)
    {
        Curve memory c = curveOf(book);
        int24 s = book.tickSpacing();
        int24 cur = IRangeOrderBook(address(book)).currentTick();
        endTick = cur;
        uint16 takerFeeBps = book.takerFeeBps();
        uint256 grossBudget = _maxGrossForTotal(amount0In, takerFeeBps);

        int256 B;
        (int24 e, bool found) = _prevActiveBid(book, _floorAligned(cur - 1, s), s);
        for (uint256 i = 0; found && i < maxRuns; i++) {
            (int24 e2, bool found2) = _prevActiveBid(book, e - s, s);
            int256 a0 = B + book.bidDelta(e);
            if (a0 < 0) break; // defensive
            if (a0 == 0 || !found2) {
                // closing edge (or no further endpoints): nothing fillable
                // in this run; well-formed ladders always close with a set
                // bit, so !found2 with a0 > 0 cannot fill either
                if (!found2) break;
                B = a0;
                e = e2;
                continue;
            }
            uint256 n = uint256(uint24(e - e2)) / uint256(uint24(s));

            (uint256 in0, uint256 out1) = _bidRunAmounts(c, e, a0, n, s);
            if (amount0Spent + in0 > grossBudget) {
                // uniform run: the affordable prefix is one division
                // (mirrors the book's park subdivision)
                uint256 fit = (grossBudget - amount0Spent) / uint256(a0);
                if (fit > n) fit = n;
                if (fit > 0) {
                    (uint256 fi0, uint256 fo1) = _bidRunAmounts(c, e, a0, fit, s);
                    amount0Spent += fi0;
                    amount1Out += fo1;
                    endTick = e - int24(uint24(fit)) * s + s;
                }
                amount0Spent += _feeAmount(amount0Spent, takerFeeBps);
                return (amount1Out, amount0Spent, endTick);
            }
            amount0Spent += in0;
            amount1Out += out1;
            endTick = e2 + s;
            B = a0;
            e = e2;
            found = found2;
        }
        amount0Spent += _feeAmount(amount0Spent, takerFeeBps);
        return (amount1Out, amount0Spent, endTick);
    }

    // ------------------------------------------------------------------
    // internals (mirror the book's math/bitmap walks, read-only)
    // ------------------------------------------------------------------

    /// @dev ask run [e, e+n*s): uniform size `a0`, taker pays ceil. Mirrors
    /// the book's `_askRun` override on each curve.
    function _runAmounts(Curve memory c, int24 e, int256 a0, uint256 n, int24 s)
        internal
        pure
        returns (uint256 out0, uint256 cost1)
    {
        if (c.geo) {
            // the a0 == 0 short-circuit keeps powX18 inside its domain on the
            // open-ended tail run past the last endpoint
            if (a0 <= 0) return (0, 0);
            out0 = uint256(a0) * n;
            uint256 num = uint256(a0) * (GeoTickMath.powX18(e + int24(uint24(n)) * s) - GeoTickMath.powX18(e));
            cost1 = (num + c.d - 1) / c.d;
            return (out0, cost1);
        }
        int256 ni = int256(n);
        int256 sumK = (ni * (ni - 1)) / 2;
        int256 tot0 = a0 * ni;
        int256 c0 = int256(PRICE_SCALE) + int256(e) * 1e15;
        int256 c1 = int256(s) * 1e15;
        int256 val = a0 * c0 * ni + a0 * c1 * sumK;
        if (tot0 < 0 || val < 0) return (0, 0);
        out0 = uint256(tot0);
        cost1 = (uint256(val) + PRICE_SCALE - 1) / PRICE_SCALE;
    }

    /// @dev bid run e, e-s, ..., e-(n-1)*s (descending, uniform): taker
    /// receives floor. Mirrors the book's `_bidRunAmounts` on each curve.
    function _bidRunAmounts(Curve memory c, int24 e, int256 a0, uint256 n, int24 s)
        internal
        pure
        returns (uint256 in0, uint256 out1)
    {
        if (c.geo) {
            if (a0 <= 0) return (0, 0);
            in0 = uint256(a0) * n;
            uint256 num = uint256(a0) * (GeoTickMath.powX18(e + s) - GeoTickMath.powX18(e - int24(uint24(n - 1)) * s));
            out1 = num / c.d;
            return (in0, out1);
        }
        int256 ni = int256(n);
        int256 sumK = (ni * (ni - 1)) / 2;
        int256 tot0 = a0 * ni;
        int256 c0 = int256(PRICE_SCALE) + int256(e) * 1e15;
        int256 c1 = int256(s) * 1e15;
        int256 val = a0 * c0 * ni - a0 * c1 * sumK; // levels descend from e
        if (tot0 < 0 || val < 0) return (0, 0);
        in0 = uint256(tot0);
        out1 = uint256(val) / PRICE_SCALE;
    }

    function _maxAffordable(Curve memory c, int24 e, int256 a0, uint256 n, uint256 budget, int24 s)
        internal
        pure
        returns (uint256 m)
    {
        uint256 lo = 0;
        uint256 hi = n;
        while (lo < hi) {
            uint256 mid = (lo + hi + 1) / 2;
            (, uint256 cost) = _runAmounts(c, e, a0, mid, s);
            if (cost <= budget) lo = mid;
            else hi = mid - 1;
        }
        return lo;
    }

    function _feeAmount(uint256 amount, uint16 feeBps) internal pure returns (uint256) {
        return (amount * feeBps) / 10_000;
    }

    function _maxGrossForTotal(uint256 maxTotal, uint16 feeBps) internal pure returns (uint256) {
        if (feeBps == 0 || maxTotal == type(uint256).max) return maxTotal;
        uint256 denominator = 10_000 + uint256(feeBps);
        return (maxTotal / denominator) * 10_000 + ((maxTotal % denominator) * 10_000) / denominator;
    }

    function _nextActiveAsk(FrontierBookBase book, int24 fromT, int24 maxT, int24 s)
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

    function _prevActiveBid(FrontierBookBase book, int24 fromT, int24 s) internal view returns (int24, bool) {
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

    function _maxTick(Curve memory c, int24 s) internal pure returns (int24) {
        int24 cap = c.geo ? GeoTickMath.MAX_TICK : int24(8388000);
        return (cap / s) * s;
    }
}
