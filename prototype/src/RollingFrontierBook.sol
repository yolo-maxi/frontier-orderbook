// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IRangeOrderBook} from "./IRangeOrderBook.sol";
import {IERC20Minimal} from "./RangeTakeProfitBook.sol";

/// @title RollingFrontierBook — width-O(1) production candidate
///
/// Exploits a property the fill-clock book leaves on the table: because a
/// valid sell-above position is born with `lower > currentTick`, its personal
/// filled region can never fragment — it is always a contiguous prefix
/// `[lower, frontier)` of its range. (The GLOBAL set of intervals filled
/// since a timestamp fragments under price oscillation, but any one
/// position's view of it is prefix-shaped: to fill a higher interval of the
/// range, price must first have crossed every lower one after the deposit.)
///
/// So instead of materializing per-interval buckets at deposit, each order
/// contributes two endpoint deltas:
///
///   frontierDelta[lower] += L      (its current unfilled frontier)
///   frontierDelta[upper] -= L
///
/// When price fully crosses interval [t, t+s), the liquidity whose frontier
/// is t — exactly `frontierDelta[t]`, since earlier crossings rolled
/// everyone else forward — is consumed, and the surviving suffix rolls:
/// `frontierDelta[t+s] += frontierDelta[t]`. A fully consumed order's +L
/// rolls into its own upper and cancels against its -L. Filled liquidity
/// ceases to exist at the interval, so no-resurrection holds by construction,
/// same as the bucket design — the bucket is just implicit now.
///
/// Eligibility uses the same global fill clock, keyed by UPPER boundary:
/// `boundaryFillClock[u] > depositClock` proves interval [u-s, u) filled
/// after deposit; prefix-contiguity then proves everything below it in the
/// range filled too. Hence O(1) claims/cancels against a caller-supplied
/// boundary witness, or O(log width) without one (binary search over the
/// prefix-monotone fill predicate).
///
/// Complexity: deposit O(1), requote O(1), claimTo/cancelWithWitness O(1),
/// swap O(crossed intervals + bitmap words skipped), all independent of user
/// count AND range width.
///
/// Venue caveat: this CANNOT back a vanilla v4 hook holding real pool
/// liquidity — only the frontier interval would be materialized in the pool,
/// so a single swap sweeping several intervals would glide through the
/// unmaterialized ones without converting them. It is a standalone venue
/// (order book / vault / custom-accounting AMM).
///
/// Partial fills: whole-interval granularity by design ("thin ticks"); the
/// watermark sub-interval design was prototyped and reverted — see
/// NOTES-partial-fills.md.
///
/// Dust policy (differs from the bucket book): fills collect
/// ceil(totalL * rate) per interval; claims pay floor(L * spanRate) over the
/// claimed span in one rounding. Sum of span-floors <= sum of interval-ceils,
/// so no overclaim; payouts remain claim-order independent per position.
contract RollingFrontierBook is IRangeOrderBook {
    IERC20Minimal public immutable token0;
    IERC20Minimal public immutable token1;
    int24 public immutable tickSpacing;

    int24 public currentTick;
    uint64 public fillClock;
    uint256 public nextPositionId = 1;

    // signed: +L at live frontiers, -L at order uppers; rolls self-cancel
    mapping(int24 => int256) public frontierDelta;
    // SECOND-ORDER deltas for shaped (linear-ladder) orders: the aggregate
    // per-level size increment in effect from each boundary. Rolls forward
    // with the value accumulator: A(t+s) = A(t) + S(t+s). Uniform orders
    // never touch it. Levels covered by any order always have size >= 1
    // (enforced at deposit), so the value bitmap alone drives sweeps and the
    // slope accumulator piggybacks on the roll chain.
    mapping(int24 => int256) public frontierSlope;
    // one bit per tick-spacing interval with nonzero frontierDelta, so sweeps
    // skip empty price regions in O(1) per 256 intervals instead of one SLOAD
    // per interval (which would brick sweeps across wide gaps)
    mapping(int16 => uint256) public tickBitmap;
    // upper boundary u: global clock when [u-s, u) last filled with liquidity
    mapping(int24 => uint64) public boundaryFillClock;

    // lowest boundary ever used; only for the O(width) view scans
    int24 internal _minBoundary;
    bool internal _minBoundarySet;

    struct Position {
        address owner;
        int24 lower;
        int24 upper;
        uint128 liquidity; // size at `lower` (L0)
        int128 slope; // per-level size increment; size at level j = L0 + slope*j
        uint64 depositClock;
        int24 claimedUpper; // proceeds already paid for [lower, claimedUpper)
        bool live;
    }

    mapping(uint256 => Position) public positions;

    event Deposit(uint256 indexed positionId, address indexed owner, int24 lower, int24 upper, uint128 liquidity);
    event IntervalFilled(int24 indexed lowerTick, uint128 liquidity, uint256 proceeds1, uint64 clock);
    event Claim(uint256 indexed positionId, uint256 proceeds1);
    event Cancel(uint256 indexed positionId, uint256 proceeds1, uint256 principal0);
    event Requote(uint256 indexed positionId, int24 lower, int24 upper, uint128 liquidity);

    constructor(address _token0, address _token1, int24 _tickSpacing, int24 _initialTick) {
        require(_tickSpacing > 0, "bad spacing");
        token0 = IERC20Minimal(_token0);
        token1 = IERC20Minimal(_token1);
        tickSpacing = _tickSpacing;
        currentTick = _initialTick;
    }

    // ------------------------------------------------------------------
    // Orders
    // ------------------------------------------------------------------

    /// @notice O(1): two endpoint writes regardless of range width.
    function deposit(int24 lower, int24 upper, uint128 liquidity) external returns (uint256 positionId) {
        return depositShaped(lower, upper, liquidity, 0);
    }

    /// @notice O(1) SHAPED ladder: size at level j is `liquidity + slope*j`
    /// (piecewise-linear profiles compose from multiple positions). Four
    /// endpoint writes regardless of range width. Every level's size must be
    /// >= 1 so covered levels are always visible to the sweep bitmap.
    function depositShaped(int24 lower, int24 upper, uint128 liquidity, int128 slope)
        public
        returns (uint256 positionId)
    {
        require(liquidity > 0, "zero liquidity");
        _checkRange(lower, upper);
        _checkShape(lower, upper, liquidity, slope);

        _addOrder(lower, upper, liquidity, slope);

        positionId = nextPositionId++;
        positions[positionId] = Position({
            owner: msg.sender,
            lower: lower,
            upper: upper,
            liquidity: liquidity,
            slope: slope,
            depositClock: fillClock,
            claimedUpper: lower,
            live: true
        });

        uint256 amount0 = _principalSpan(liquidity, slope, 0, _levels(lower, upper));
        require(token0.transferFrom(msg.sender, address(this), amount0), "transfer in failed");
        emit Deposit(positionId, msg.sender, lower, upper, liquidity);
    }

    /// @notice O(1) re-price for quoters: move a completely UNFILLED order to
    /// a new range (and optionally new size) in place — four endpoint-delta
    /// writes, no token transfers when the principal is unchanged. The
    /// position's clock refreshes, so it joins the new levels' current
    /// lifecycles exactly as a fresh deposit would. Reverts if any interval
    /// has filled (settle via claim/cancel first).
    function requote(uint256 positionId, int24 newLower, int24 newUpper, uint128 newLiquidity) external {
        requoteShaped(positionId, newLower, newUpper, newLiquidity, 0);
    }

    /// @notice O(1) re-price (and optionally re-shape/re-size) of a
    /// completely unfilled order; tokens settle difference-only.
    function requoteShaped(uint256 positionId, int24 newLower, int24 newUpper, uint128 newLiquidity, int128 newSlope)
        public
    {
        Position storage p = positions[positionId];
        require(p.live, "not live");
        require(msg.sender == p.owner, "not owner");
        // completely unfilled <=> first interval not filled since deposit
        // (prefix-contiguity: nothing above it can have filled either)
        require(boundaryFillClock[p.lower + tickSpacing] <= p.depositClock, "partially filled");
        _checkRange(newLower, newUpper);
        _checkShape(newLower, newUpper, newLiquidity, newSlope);

        // remove old endpoint entries (order unfilled: frontier == lower),
        // place new ones
        _removeOrderAt(p.lower, p.lower, p.upper, p.liquidity, p.slope);
        _addOrder(newLower, newUpper, newLiquidity, newSlope);

        uint256 oldAmount0 = _principalSpan(p.liquidity, p.slope, 0, _levels(p.lower, p.upper));
        uint256 newAmount0 = _principalSpan(newLiquidity, newSlope, 0, _levels(newLower, newUpper));

        p.lower = newLower;
        p.upper = newUpper;
        p.liquidity = newLiquidity;
        p.slope = newSlope;
        p.depositClock = fillClock;
        p.claimedUpper = newLower;

        if (newAmount0 > oldAmount0) {
            require(token0.transferFrom(msg.sender, address(this), newAmount0 - oldAmount0), "transfer in failed");
        } else if (oldAmount0 > newAmount0) {
            require(token0.transfer(msg.sender, oldAmount0 - newAmount0), "transfer out failed");
        }
        emit Requote(positionId, newLower, newUpper, newLiquidity);
    }

    /// @notice O(1) claim against a boundary witness: pays the span
    /// (claimedUpper, target]. Underclaiming is harmless; overclaiming is
    /// impossible because `target`'s interval must have filled after deposit,
    /// and prefix-contiguity covers everything below it.
    function claimTo(uint256 positionId, int24 target) public returns (uint256 proceeds1) {
        Position storage p = positions[positionId];
        require(p.live, "not live");
        require(msg.sender == p.owner, "not owner");
        require(target > p.claimedUpper && target <= p.upper, "bad target");
        require((target - p.lower) % tickSpacing == 0, "unaligned target");
        require(boundaryFillClock[target] > p.depositClock, "not filled");

        proceeds1 = _spanAmt1(p, p.claimedUpper, target);
        p.claimedUpper = target;

        if (proceeds1 > 0) require(token1.transfer(p.owner, proceeds1), "transfer out failed");
        emit Claim(positionId, proceeds1);
    }

    /// @notice Convenience variant: finds the frontier itself in O(log width).
    function claim(uint256 positionId) external returns (uint256 proceeds1) {
        Position storage p = positions[positionId];
        require(p.live, "not live");
        require(msg.sender == p.owner, "not owner");
        int24 frontier = _frontier(p);
        if (frontier <= p.claimedUpper) {
            emit Claim(positionId, 0);
            return 0;
        }
        return claimTo(positionId, frontier);
    }

    /// @notice O(1) cancel against a maximal-frontier witness: pays unclaimed
    /// filled proceeds, returns the unfilled suffix principal, removes the
    /// order's endpoint deltas, retires the position.
    function cancelWithWitness(uint256 positionId, int24 frontier)
        public
        returns (uint256 proceeds1, uint256 principal0)
    {
        Position storage p = positions[positionId];
        require(p.live, "not live");
        require(msg.sender == p.owner, "not owner");
        require(frontier >= p.lower && frontier <= p.upper, "frontier out of range");
        require((frontier - p.lower) % tickSpacing == 0, "unaligned frontier");
        // proves frontier is filled-up-to...
        if (frontier > p.lower) require(boundaryFillClock[frontier] > p.depositClock, "frontier not filled");
        // ...and maximal (next interval NOT filled since deposit)
        if (frontier < p.upper) {
            require(boundaryFillClock[frontier + tickSpacing] <= p.depositClock, "frontier not maximal");
        }

        if (frontier > p.claimedUpper) {
            proceeds1 = _spanAmt1(p, p.claimedUpper, frontier);
            p.claimedUpper = frontier;
        }
        if (frontier < p.upper) {
            _removeOrderAt(frontier, p.lower, p.upper, p.liquidity, p.slope);
            principal0 =
                _principalSpan(p.liquidity, p.slope, _levelOf(p, frontier), _levels(p.lower, p.upper));
        }
        // if frontier == upper the order fully consumed: its +L already rolled
        // into upper and self-cancelled against its -L; nothing to remove.
        p.live = false;

        if (proceeds1 > 0) require(token1.transfer(p.owner, proceeds1), "transfer out failed");
        if (principal0 > 0) require(token0.transfer(p.owner, principal0), "transfer out failed");
        emit Cancel(positionId, proceeds1, principal0);
    }

    /// @notice Convenience variant: finds the frontier itself in O(log width).
    function cancel(uint256 positionId) external returns (uint256 proceeds1, uint256 principal0) {
        Position storage p = positions[positionId];
        require(p.live, "not live");
        require(msg.sender == p.owner, "not owner");
        return cancelWithWitness(positionId, _frontier(p));
    }

    // ------------------------------------------------------------------
    // Market simulation (stands in for the venue's swap path)
    // ------------------------------------------------------------------

    /// @notice Unbounded sweep (interface compatibility). Downward moves are
    /// free pointer retreats; depositors should BUNDLE a retreat with their
    /// deposit (retreats change no fills, stamps, or deltas, so they are
    /// harmless to third parties — and the bundle defeats pointer-pinning
    /// griefing, since a pin cannot land inside someone else's transaction).
    function moveTickTo(int24 newTick) external {
        sweep(newTick, type(uint256).max);
    }

    /// @notice Bounded, resumable taker sweep. Crosses at most `maxFills`
    /// non-empty intervals, walking the tick bitmap so empty price regions
    /// cost one word-read per 256 intervals instead of one read each. If the
    /// fill budget runs out, the pointer parks at the lower boundary of the
    /// first unfilled interval and a later sweep resumes from there.
    /// Per crossed interval: consume the aggregate frontier liquidity, roll
    /// the surviving suffix forward, stamp the boundary. Never touches
    /// positions.
    function sweep(int24 target, uint256 maxFills) public returns (int24 reached) {
        int24 oldTick = currentTick;
        if (target <= oldTick) {
            currentTick = target;
            return target;
        }

        uint256 owed0;
        uint256 owed1;
        uint256 fills;
        // lowest interval whose upper boundary lies in (oldTick, target]
        int24 cursorT = _nextBoundaryAbove(oldTick) - tickSpacing;
        reached = target;

        while (true) {
            (int24 t, bool found) = _nextActive(cursorT, target - tickSpacing);
            if (!found) break; // nothing left to fill: pointer goes to target
            if (fills == maxFills) {
                // budget exhausted with liquidity remaining at t: park just
                // below it so a later sweep resumes exactly there
                reached = t > oldTick ? t : oldTick;
                break;
            }

            // active liquidity at t = rolled base + slope in effect at t
            // (slope advance is applied at CONSUMPTION time, so value slots
            // always hold pure bases/jumps and the prefix-sum view stays
            // consistent)
            int256 slopeAtT = frontierSlope[t];
            int256 d = frontierDelta[t] + slopeAtT;
            // crossings happen left-to-right, so every covering order has
            // rolled into t before t is crossed; negative is unreachable
            require(d > 0, "negative frontier");

            int24 u = t + tickSpacing;
            // roll the shape accumulator: slope in effect at u = slope at t
            // plus resting slope entries at u
            int256 slopeAtU = slopeAtT + frontierSlope[u];
            if (slopeAtT != 0) {
                frontierSlope[t] = 0;
            }
            if (slopeAtU != frontierSlope[u]) {
                frontierSlope[u] = slopeAtU;
            }
            _writeDelta(t, 0);
            _writeDelta(u, frontierDelta[u] + d); // self-cancels for orders ending at u
            uint64 clock = ++fillClock;
            boundaryFillClock[u] = clock;

            uint128 liq = uint128(uint256(d));
            uint256 proceeds1 = _ceilAmt1(t, liq); // contract-favorable collection
            owed0 += uint256(liq);
            owed1 += proceeds1;
            emit IntervalFilled(t, liq, proceeds1, clock);

            unchecked {
                fills++;
            }
            cursorT = u;
        }

        currentTick = reached;
        if (owed1 > 0) require(token1.transferFrom(msg.sender, address(this), owed1), "fill payment failed");
        if (owed0 > 0) require(token0.transfer(msg.sender, owed0), "fill payout failed");
    }

    // ------------------------------------------------------------------
    // Views (interface compatibility — scans are view-only convenience;
    // production frontends compute the witness off-chain)
    // ------------------------------------------------------------------

    function claimable(uint256 positionId) external view returns (uint256) {
        Position storage p = positions[positionId];
        if (!p.live) return 0;
        int24 frontier = _frontier(p);
        if (frontier <= p.claimedUpper) return 0;
        return _spanAmt1(p, p.claimedUpper, frontier);
    }

    function unfilledPrincipal(uint256 positionId) external view returns (uint256) {
        Position storage p = positions[positionId];
        if (!p.live) return 0;
        int24 frontier = _frontier(p);
        return _principalSpan(p.liquidity, p.slope, _levelOf(p, frontier), _levels(p.lower, p.upper));
    }

    function isConsumedFor(uint256 positionId, int24 lowerTick) external view returns (bool) {
        Position storage p = positions[positionId];
        return boundaryFillClock[lowerTick + tickSpacing] > p.depositClock;
    }

    /// @dev Aggregate live liquidity covering [lowerTick, lowerTick+s) =
    /// prefix sum of endpoint deltas: +L counted iff frontier <= t, -L
    /// cancels it iff upper <= t — i.e. exactly orders with
    /// frontier <= t < upper.
    function activeLiquidity(int24 lowerTick) external view returns (uint128) {
        if (!_minBoundarySet || lowerTick < _minBoundary) return 0;
        int256 sum;
        int256 slope;
        for (int24 u = _minBoundary; u <= lowerTick; u += tickSpacing) {
            slope += frontierSlope[u];
            sum += frontierDelta[u] + slope;
        }
        require(sum >= 0, "negative active");
        return uint128(uint256(sum));
    }

    // ------------------------------------------------------------------
    // Internals
    // ------------------------------------------------------------------

    function _checkRange(int24 lower, int24 upper) internal view {
        require(lower < upper, "empty range");
        require(lower % tickSpacing == 0 && upper % tickSpacing == 0, "unaligned");
        require(lower > currentTick, "range not above price");
    }

    function _levels(int24 lower, int24 upper) internal view returns (uint24) {
        return uint24(upper - lower) / uint24(tickSpacing);
    }

    function _levelOf(Position storage p, int24 t) internal view returns (uint24) {
        return uint24(t - p.lower) / uint24(tickSpacing);
    }

    /// @dev size at level j of a shaped order
    function _sizeAt(uint128 l0, int128 m, uint24 j) internal pure returns (int256) {
        return int256(uint256(l0)) + int256(m) * int256(uint256(j));
    }

    function _checkShape(int24 lower, int24 upper, uint128 l0, int128 m) internal view {
        uint24 n = _levels(lower, upper);
        // linear => extrema at the endpoints; every covered level must hold
        // at least 1 unit so the sweep bitmap sees it
        require(_sizeAt(l0, m, 0) >= 1 && _sizeAt(l0, m, n - 1) >= 1, "level size < 1");
    }

    function _addOrder(int24 lower, int24 upper, uint128 liquidity, int128 slope) internal {
        _writeDelta(lower, frontierDelta[lower] + int256(uint256(liquidity)));
        uint24 n = _levels(lower, upper);
        int256 lastSize = _sizeAt(liquidity, slope, n - 1);
        _writeDelta(upper, frontierDelta[upper] - lastSize);
        if (slope != 0) {
            // slope takes effect from the SECOND level; ends at upper.
            // (single-level orders: the two writes hit the same slot, net 0)
            frontierSlope[lower + tickSpacing] += int256(slope);
            frontierSlope[upper] -= int256(slope);
        }
        if (!_minBoundarySet || lower < _minBoundary) {
            _minBoundary = lower;
            _minBoundarySet = true;
        }
    }

    /// @dev Remove an order's remaining tail [frontier, upper). At an
    /// untouched frontier (== lower) the order's slot contribution is its L0
    /// jump and its slope entry rests at lower+s. At a rolled-into frontier,
    /// the value slot holds the order's PREVIOUS level's base (the slope
    /// advance is applied at consumption), and its slope lives in the
    /// frontier's absorbed slope slot.
    function _removeOrderAt(int24 frontier, int24 lower, int24 upper, uint128 liquidity, int128 slope) internal {
        uint24 jF = uint24(frontier - lower) / uint24(tickSpacing);
        uint24 n = _levels(lower, upper);
        if (frontier == lower) {
            _writeDelta(frontier, frontierDelta[frontier] - _sizeAt(liquidity, slope, 0));
            if (slope != 0) frontierSlope[lower + tickSpacing] -= int256(slope);
        } else {
            _writeDelta(frontier, frontierDelta[frontier] - _sizeAt(liquidity, slope, jF - 1));
            if (slope != 0) frontierSlope[frontier] -= int256(slope);
        }
        _writeDelta(upper, frontierDelta[upper] + _sizeAt(liquidity, slope, n - 1));
        if (slope != 0) frontierSlope[upper] += int256(slope);
    }

    /// @dev Single write path for deltas, keeping the bitmap in sync:
    /// bit set <=> frontierDelta != 0.
    function _writeDelta(int24 t, int256 newVal) internal {
        int256 old = frontierDelta[t];
        if (old == newVal) return;
        frontierDelta[t] = newVal;
        if (old == 0 || newVal == 0) {
            int24 c = t / tickSpacing; // exact: t is always spacing-aligned
            int16 wordPos = int16(c >> 8);
            uint8 bitPos = uint8(uint24(c)); // low 8 bits, two's complement safe
            if (newVal != 0) tickBitmap[wordPos] |= (uint256(1) << bitPos);
            else tickBitmap[wordPos] &= ~(uint256(1) << bitPos);
        }
    }

    /// @dev Smallest spacing-aligned t in [fromT, maxT] with nonzero delta,
    /// scanning whole bitmap words.
    function _nextActive(int24 fromT, int24 maxT) internal view returns (int24, bool) {
        if (fromT > maxT) return (0, false);
        int24 c = fromT / tickSpacing;
        int24 cMax = maxT / tickSpacing;
        while (c <= cMax) {
            int16 wordPos = int16(c >> 8);
            uint8 bitPos = uint8(uint24(c));
            uint256 word = tickBitmap[wordPos] >> bitPos;
            if (word != 0) {
                int24 cFound = c + int24(uint24(_lsb(word)));
                if (cFound > cMax) return (0, false);
                return (cFound * tickSpacing, true);
            }
            c = (int24(wordPos) + 1) * 256;
        }
        return (0, false);
    }

    function _lsb(uint256 x) private pure returns (uint8 r) {
        // precondition: x != 0
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

    /// @dev Find the position's frontier by BINARY SEARCH: within the
    /// position's own range, `boundaryFillClock[u] > depositClock` is a
    /// prefix-monotone predicate (true for every boundary up to the frontier,
    /// false above it — this is the prefix-contiguity theorem), so the
    /// frontier is found in O(log width) SLOADs. Starts from claimedUpper,
    /// which is always <= the true frontier (it only ever advances past
    /// boundaries proven filled, and stamps only grow).
    function _frontier(Position storage p) internal view returns (int24 lo) {
        lo = p.claimedUpper;
        uint24 n = uint24(p.upper - lo) / uint24(tickSpacing); // candidate boundaries above lo
        while (n > 0) {
            uint24 half = (n + 1) / 2;
            int24 cand = lo + int24(half) * tickSpacing;
            if (boundaryFillClock[cand] > p.depositClock) {
                lo = cand;
                n -= half;
            } else {
                n = half - 1;
            }
        }
    }

    uint256 internal constant PRICE_SCALE = 1e18;

    /// @dev Proceeds for the position's levels in [a, b): closed-form sum of
    /// size(j) * rate(tick(j)) — size linear in j, rate linear in tick, so
    /// the sum is a quadratic series, floored ONCE over the whole span (the
    /// single rounding is what makes O(1) payouts possible).
    /// rate(t) = 1e18 + t*1e15, same linear curve as RangeTakeProfitBook.
    function _spanAmt1(Position storage p, int24 a, int24 b) internal view returns (uint256) {
        int256 sp = int256(tickSpacing);
        int256 ja = (int256(a) - int256(p.lower)) / sp;
        int256 n = (int256(b) - int256(a)) / sp;
        int256 jb = ja + n; // exclusive
        // sums over j in [ja, jb)
        int256 s1 = n;
        int256 sj = ((ja + jb - 1) * n) / 2;
        int256 sj2 = ((jb - 1) * jb * (2 * jb - 1) - (ja - 1) * ja * (2 * ja - 1)) / 6;
        // size(j) = L0 + m*j ; rate(j) = C0 + C1*j, with C0 = 1e18 + lower*1e15, C1 = s*1e15
        int256 l0 = int256(uint256(p.liquidity));
        int256 m = int256(p.slope);
        int256 c0 = int256(PRICE_SCALE) + int256(p.lower) * 1e15;
        int256 c1 = sp * 1e15;
        int256 total = l0 * c0 * s1 + (l0 * c1 + m * c0) * sj + m * c1 * sj2;
        require(total >= 0, "rate underflow");
        return uint256(total) / PRICE_SCALE;
    }

    /// @dev Sum of level sizes for levels j in [jStart, jEnd).
    function _principalSpan(uint128 l0, int128 m, uint24 jStart, uint24 jEnd) internal pure returns (uint256) {
        int256 n = int256(uint256(jEnd)) - int256(uint256(jStart));
        if (n <= 0) return 0;
        int256 sj = ((int256(uint256(jStart)) + int256(uint256(jEnd)) - 1) * n) / 2;
        int256 total = int256(uint256(l0)) * n + int256(m) * sj;
        require(total >= 0, "negative principal");
        return uint256(total);
    }

    /// @dev Contract-favorable per-interval collection at fill time.
    function _ceilAmt1(int24 lowerTick, uint128 liquidity) internal view returns (uint256) {
        int256 rate = int256(PRICE_SCALE) + int256(lowerTick) * 1e15;
        require(rate > 0, "rate underflow");
        return (uint256(liquidity) * uint256(rate) + PRICE_SCALE - 1) / PRICE_SCALE;
    }

    function _nextBoundaryAbove(int24 tick) internal view returns (int24) {
        int24 b = (tick / tickSpacing) * tickSpacing;
        if (b <= tick) b += tickSpacing;
        return b;
    }
}
