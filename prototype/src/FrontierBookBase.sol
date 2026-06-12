// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20Minimal} from "./RangeTakeProfitBook.sol";
import {IFrontierHooks, FrontierHookFlags} from "./hooks/IFrontierHooks.sol";
import {IPermissionRegistry} from "./permissions/interfaces/IPermissionRegistry.sol";

/// @title FrontierBookBase — storage layout + shared machinery of the book
///
/// EIP-170 split: the deployable book is two contracts sharing this exact
/// storage layout and immutable set. `RollingFrontierBook` (the address
/// users hold) keeps the hot path — deposits, sweeps, claims, views — and
/// forwards the cold maker-management surface (requotes, cancels,
/// transfers) to a `FrontierMakerOps` companion via delegatecall. Because
/// delegatecalled code reads its OWN immutables, the companion is
/// constructed with the same (token0, token1, spacing, hooks, permissions)
/// and can be shared by every book with that config.
///
/// Everything either side touches lives here; neither deployable contract
/// declares state of its own (the core's `makerOps` is immutable, i.e.
/// code, not storage), so the delegatecall can never desynchronize layouts.
abstract contract FrontierBookBase {
    using FrontierHookFlags for address;

    IERC20Minimal public immutable token0;
    IERC20Minimal public immutable token1;
    int24 public immutable tickSpacing;
    /// v4-style hooks contract (flags in its address low bits); 0 = none
    IFrontierHooks public immutable hooks;
    /// delegatable permissions (ERC Approval Registry); 0 = owner-only
    IPermissionRegistry public immutable permissions;

    int24 internal _currentTick;
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
    // SECOND LEVEL: one bit per fine-bitmap WORD (bit set <=> that word is
    // nonzero), so gap-walks cost one SLOAD per 65,536 fine ticks and fine
    // words are read only where endpoints actually exist. Maintenance is
    // exact and O(1): the word write that empties/populates a fine word is
    // the moment its top bit flips (no lazy dirty bits, no false positives).
    // This is what makes FINE tick spacing under a COARSE maker grid cheap —
    // see NOTES-partial-fills.md.
    mapping(int16 => uint256) public tickBitmapTop;

    // ASK-side fill records: ONE entry per liquidity-moving up-sweep instead
    // of a clock stamp per level ("endpoint sweeps"). Entries keep clocks
    // strictly increasing and highs strictly decreasing (dominated entries
    // are popped), so "highest boundary covered since clock c" is the first
    // entry with clock > c — O(log sweeps). Soundness: a sweep that reached
    // boundary H crossed every boundary <= H after that clock, and it cannot
    // cover a live position's levels without consuming them (bits force
    // absorption); prefix-contiguity turns that into per-position proof.
    struct HighWater {
        uint64 clock;
        int24 high;
    }

    HighWater[] internal _highWaters;

    // ----- BID side (buy token0 with token1, resting BELOW the price) -----
    // Exact mirror of the ask machinery: sizes are token0-denominated
    // (per-level amount of token0 the maker wants to buy, so claims and
    // span sums stay closed-form), the frontier rolls DOWNWARD, and fill
    // clocks are keyed by the interval's LOWER boundary. Uniform sizes only
    // (shapes mirror mechanically; kept ask-side for now).
    mapping(int24 => int256) public bidDelta; // +B at bid frontiers (interval lower), -B at lower-s
    mapping(int16 => uint256) public bidBitmap;
    // second level of the bid bitmap (see tickBitmapTop)
    mapping(int16 => uint256) public bidBitmapTop;

    // Mirror of the high-water stack for DOWN-sweeps: one record per
    // liquidity-moving down-sweep instead of a clock stamp per boundary.
    // Entries: clocks ascending, lows strictly ascending, so the first
    // entry past a deposit clock carries the minimum boundary reached.
    struct LowWater {
        uint64 clock;
        int24 low;
    }

    LowWater[] internal _lowWaters;

    // lowest/highest boundaries ever used; only for the O(width) view scans
    int24 internal _minBoundary;
    bool internal _minBoundarySet;
    int24 internal _maxBoundary;
    bool internal _maxBoundarySet;

    struct Position {
        address owner;
        int24 lower;
        int24 upper;
        uint128 liquidity; // size at `lower` (L0)
        int128 slope; // per-level size increment; size at level j = L0 + slope*j
        uint64 depositClock;
        // asks: proceeds paid for [lower, cursor); bids: paid for [cursor, upper)
        int24 claimedUpper;
        bool live;
        bool isBid;
    }

    mapping(uint256 => Position) public positions;
    mapping(uint256 => uint256) internal internalCredit0ByPosition;
    mapping(uint256 => uint256) internal internalCredit1ByPosition;

    // Internal balance ledger: proceeds/refunds can be credited here instead
    // of transferred out, and every deposit path spends credit FIRST, pulling
    // only the shortfall via transferFrom. This is what lets earned balances
    // recycle into new orders with zero token transfers.
    mapping(address => uint256) public internalBalance0;
    mapping(address => uint256) public internalBalance1;

    event Deposit(uint256 indexed positionId, address indexed owner, int24 lower, int24 upper, uint128 liquidity);
    event IntervalFilled(int24 indexed lowerTick, uint128 liquidity, uint256 proceeds1, uint64 clock);
    event RunFilled(int24 indexed fromLevel, int24 toBoundary, uint256 startSize, int256 slopePerLevel, uint64 clock);
    event Claim(uint256 indexed positionId, uint256 proceeds1);
    event Cancel(uint256 indexed positionId, uint256 proceeds1, uint256 principal0);
    event Requote(uint256 indexed positionId, int24 lower, int24 upper, uint128 liquidity);
    event PositionTransferred(uint256 indexed positionId, address indexed from, address indexed to);
    event InternalCredit(address indexed user, uint256 amount0, uint256 amount1);
    event InternalWithdraw(address indexed user, uint256 amount0, uint256 amount1);

    uint256 internal constant PRICE_SCALE = 1e18;

    constructor(
        address _token0,
        address _token1,
        int24 _tickSpacing,
        int24 _initialTick,
        address _hooks,
        address _permissions
    ) {
        require(_tickSpacing > 0, "bad spacing");
        token0 = IERC20Minimal(_token0);
        token1 = IERC20Minimal(_token1);
        tickSpacing = _tickSpacing;
        _currentTick = _initialTick;
        hooks = IFrontierHooks(_hooks);
        permissions = IPermissionRegistry(_permissions);
    }

    // ------------------------------------------------------------------
    // Delegatable authorization (ERC Approval Registry integration):
    // the owner can always act; anyone else needs a selector-scoped grant
    // for THIS book in the registry. Payouts always go to the position
    // owner regardless of who triggers — operators manage, never receive.
    // ------------------------------------------------------------------

    function _authOwner(address owner) internal view {
        if (msg.sender != owner) {
            require(address(permissions) != address(0), "not owner");
            permissions.requireAuthorizedCall(owner, msg.sender, address(this), msg.sig);
        }
    }

    // ------------------------------------------------------------------
    // Batching: settle a whole portfolio in one transaction. Delegatecall
    // to self preserves msg.sender AND msg.sig (per inner call), so
    // authorization is byte-identical to separate transactions; the
    // savings are one 21k intrinsic + cold account/token access per
    // extra call. No function here is payable, so msg.value reuse — the
    // classic multicall hazard — does not apply.
    // ------------------------------------------------------------------

    function multicall(bytes[] calldata data) external returns (bytes[] memory results) {
        results = new bytes[](data.length);
        for (uint256 i = 0; i < data.length; i++) {
            (bool ok, bytes memory ret) = address(this).delegatecall(data[i]);
            if (!ok) {
                assembly ("memory-safe") {
                    revert(add(ret, 32), mload(ret))
                }
            }
            results[i] = ret;
        }
    }

    // ------------------------------------------------------------------
    // Hook dispatch (skipped when the hook itself is the caller)
    // ------------------------------------------------------------------

    function _callHook(uint160 flag, bytes memory data, bytes4 expected) internal {
        address h = address(hooks);
        if (h == address(0) || !h.hasFlag(flag) || msg.sender == h) return;
        (bool ok, bytes memory ret) = h.call(data);
        require(ok && ret.length >= 32 && abi.decode(ret, (bytes4)) == expected, "hook rejected");
    }

    // ------------------------------------------------------------------
    // Shared internals
    // ------------------------------------------------------------------

    function _checkRange(int24 lower, int24 upper) internal view virtual {
        require(lower < upper, "empty range");
        require(lower % tickSpacing == 0 && upper % tickSpacing == 0, "unaligned");
        require(lower > _currentTick, "range not above price");
    }

    function _checkBidRange(int24 lower, int24 upper) internal view virtual {
        require(lower < upper, "empty range");
        require(lower % tickSpacing == 0 && upper % tickSpacing == 0, "unaligned");
        require(upper <= _currentTick, "range not below price");
    }

    function _checkSweepTarget(int24) internal view virtual {}

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

    function _checkShape(int24 lower, int24 upper, uint128 l0, int128 m) internal view virtual {
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
            _writeSlope(lower + tickSpacing, frontierSlope[lower + tickSpacing] + int256(slope));
            _writeSlope(upper, frontierSlope[upper] - int256(slope));
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
            if (slope != 0) _writeSlope(lower + tickSpacing, frontierSlope[lower + tickSpacing] - int256(slope));
        } else {
            _writeDelta(frontier, frontierDelta[frontier] - _sizeAt(liquidity, slope, jF - 1));
            if (slope != 0) _writeSlope(frontier, frontierSlope[frontier] - int256(slope));
        }
        _writeDelta(upper, frontierDelta[upper] + _sizeAt(liquidity, slope, n - 1));
        if (slope != 0) _writeSlope(upper, frontierSlope[upper] + int256(slope));
    }

    function _addBid(int24 lower, int24 upper, uint128 liquidity) internal {
        _writeBidDelta(upper - tickSpacing, bidDelta[upper - tickSpacing] + int256(uint256(liquidity)));
        _writeBidDelta(lower - tickSpacing, bidDelta[lower - tickSpacing] - int256(uint256(liquidity)));
        if (!_maxBoundarySet || upper > _maxBoundary) {
            _maxBoundary = upper;
            _maxBoundarySet = true;
        }
    }

    /// @dev Bid mirror of _writeDelta, maintaining the bid bitmap (+ top).
    function _writeBidDelta(int24 t, int256 newVal) internal {
        int256 old = bidDelta[t];
        if (old == newVal) return;
        bidDelta[t] = newVal;
        if (old == 0 || newVal == 0) {
            int24 c = t / tickSpacing;
            int16 wordPos = int16(c >> 8);
            uint8 bitPos = uint8(uint24(c));
            uint256 word = bidBitmap[wordPos];
            uint256 mask = uint256(1) << bitPos;
            if (newVal != 0) {
                bidBitmap[wordPos] = word | mask;
                if (word == 0) _syncTopBit(bidBitmapTop, wordPos, true);
            } else {
                uint256 nw = word & ~mask;
                bidBitmap[wordPos] = nw;
                if (nw == 0) _syncTopBit(bidBitmapTop, wordPos, false);
            }
        }
    }

    /// @dev Flip a second-level bit. Called exactly when the underlying fine
    /// word transitions empty<->nonempty, so top bits are always exact.
    function _syncTopBit(mapping(int16 => uint256) storage top, int16 wordPos, bool set) internal {
        int16 topPos = int16(wordPos >> 8);
        uint8 bitPos = uint8(uint16(wordPos));
        uint256 mask = uint256(1) << bitPos;
        if (set) top[topPos] |= mask;
        else top[topPos] &= ~mask;
    }

    /// @dev Largest spacing-aligned t in [minT, fromT] with nonzero bidDelta,
    /// walking downward with top-bitmap jumps (mirror of _nextActive).
    function _prevActive(int24 fromT, int24 minT) internal view returns (int24, bool) {
        if (fromT < minT) return (0, false);
        int24 c = fromT / tickSpacing;
        int24 cMin = minT / tickSpacing;
        while (c >= cMin) {
            int16 wordPos = int16(c >> 8);
            uint8 bitPos = uint8(uint24(c));
            // keep bits at and below bitPos
            uint256 word = bidBitmap[wordPos] << (255 - bitPos);
            if (word != 0) {
                int24 cFound = c - int24(uint24(255 - _msb(word)));
                if (cFound < cMin) return (0, false);
                return (cFound * tickSpacing, true);
            }
            (int24 prevWord, bool ok) = _prevDirtyWord(bidBitmapTop, int24(wordPos) - 1, cMin >> 8);
            if (!ok) return (0, false);
            c = prevWord * 256 + 255;
        }
        return (0, false);
    }

    /// @dev Largest fine-word index in [minW, fromW] whose top bit is set.
    function _prevDirtyWord(mapping(int16 => uint256) storage top, int24 fromW, int24 minW)
        private
        view
        returns (int24, bool)
    {
        int24 w = fromW;
        while (w >= minW) {
            int16 topPos = int16(w >> 8);
            uint8 bitPos = uint8(uint24(w));
            uint256 word = top[topPos] << (255 - bitPos);
            if (word != 0) {
                int24 found = w - int24(uint24(255 - _msb(word)));
                if (found < minW) return (0, false);
                return (found, true);
            }
            w = (int24(topPos) * 256) - 1;
        }
        return (0, false);
    }

    function _msb(uint256 x) private pure returns (uint8 r) {
        // precondition: x != 0
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

    /// @dev Mirror of _frontier: lowest boundary covered by any down-sweep
    /// since the bid's deposit, clamped to its range (prefix-from-the-top
    /// contiguity makes the clamp exact). O(log sweep-records).
    function _bidFrontier(Position storage p) internal view returns (int24 hi) {
        hi = p.claimedUpper;
        int24 lw = _lowSince(p.depositClock);
        if (lw < hi) hi = lw < p.lower ? p.lower : lw;
    }

    function _floorAligned(int24 x) internal view returns (int24) {
        int24 q = x / tickSpacing;
        if (x < 0 && x % tickSpacing != 0) q -= 1;
        return q * tickSpacing;
    }

    /// @dev token1 value of `size` token0-units per level over [a, b) at the
    /// linear rate curve; ceil = book-favorable (bid deposits), floor = payouts.
    function _uniformSpanValue(int24 a, int24 b, uint128 size, bool roundUp) internal view virtual returns (uint256) {
        int256 sp = int256(tickSpacing);
        int256 n = (int256(b) - int256(a)) / sp;
        int256 tickSum = n * int256(a) + (sp * n * (n - 1)) / 2;
        int256 rateSum = n * int256(PRICE_SCALE) + tickSum * 1e15;
        require(rateSum > 0, "rate underflow");
        uint256 v = uint256(size) * uint256(rateSum);
        return roundUp ? (v + PRICE_SCALE - 1) / PRICE_SCALE : v / PRICE_SCALE;
    }

    function _rate(int24 t) internal pure virtual returns (uint256) {
        int256 r = int256(PRICE_SCALE) + int256(t) * 1e15;
        require(r > 0, "rate underflow");
        return uint256(r);
    }

    /// @dev token0 sold and token1 collected (ceil, contract-favorable) for
    /// an affine run of `n` levels starting at level `e` with start size
    /// `a0` and per-level slope `slope`. Closed form: size linear in k,
    /// rate linear in tick => quadratic series.
    function _runAmounts(int24 e, int256 a0, int256 slope, uint256 n)
        internal
        view
        virtual
        returns (uint256 out0, uint256 cost1)
    {
        int256 ni = int256(n);
        int256 sumK = (ni * (ni - 1)) / 2;
        int256 sumK2 = ((ni - 1) * ni * (2 * ni - 1)) / 6;
        int256 tot0 = a0 * ni + slope * sumK;
        int256 c0 = int256(PRICE_SCALE) + int256(e) * 1e15;
        int256 c1 = int256(tickSpacing) * 1e15;
        int256 val = a0 * c0 * ni + (a0 * c1 + slope * c0) * sumK + slope * c1 * sumK2;
        require(tot0 >= 0 && val >= 0, "negative run");
        out0 = uint256(tot0);
        cost1 = (uint256(val) + PRICE_SCALE - 1) / PRICE_SCALE;
    }

    /// @dev token0 collected and token1 paid out (floor, contract-favorable)
    /// for a uniform descending run of `n` levels starting at level `e` with
    /// per-level size `a0`. Rate linear in tick => arithmetic series.
    function _bidRunAmounts(int24 e, int256 a0, uint256 n) internal view virtual returns (uint256 in0, uint256 out1) {
        int256 ni = int256(n);
        int256 sumK = (ni * (ni - 1)) / 2;
        int256 tot0 = a0 * ni;
        int256 c0 = int256(PRICE_SCALE) + int256(e) * 1e15;
        int256 c1 = int256(tickSpacing) * 1e15;
        int256 val = a0 * c0 * ni - a0 * c1 * sumK; // levels descend from e
        require(tot0 >= 0 && val >= 0, "negative run");
        in0 = uint256(tot0);
        out1 = uint256(val) / PRICE_SCALE;
    }

    /// @dev Spend the payer's internal token0 credit first; transferFrom
    /// only the shortfall.
    function _pull0(address payer, uint256 amount) internal {
        uint256 credit = internalBalance0[payer];
        if (credit >= amount) {
            internalBalance0[payer] = credit - amount;
            return;
        }
        if (credit > 0) internalBalance0[payer] = 0;
        _transferInExact(token0, payer, amount - credit, "non-exact token0 transfer");
    }

    /// @dev Mirror for token1.
    function _pull1(address payer, uint256 amount) internal {
        uint256 credit = internalBalance1[payer];
        if (credit >= amount) {
            internalBalance1[payer] = credit - amount;
            return;
        }
        if (credit > 0) internalBalance1[payer] = 0;
        _transferInExact(token1, payer, amount - credit, "non-exact token1 transfer");
    }

    function _transferInExact(IERC20Minimal token, address payer, uint256 amount, string memory err) internal {
        if (amount == 0) return;
        uint256 beforeBal = token.balanceOf(address(this));
        require(token.transferFrom(payer, address(this), amount), "transfer in failed");
        require(token.balanceOf(address(this)) - beforeBal == amount, err);
    }

    /// @dev Single write paths for the ask ledgers, keeping the bitmap in
    /// sync. Bit set <=> frontierDelta != 0 OR frontierSlope != 0 — runs
    /// telescope between set bits, so a slope-only endpoint MUST be visible
    /// or a run would sail over a shape change.
    function _writeDelta(int24 t, int256 newVal) internal {
        int256 old = frontierDelta[t];
        if (old == newVal) return;
        frontierDelta[t] = newVal;
        if (old == 0 || newVal == 0) _syncAskBit(t);
    }

    function _writeSlope(int24 t, int256 newVal) internal {
        int256 old = frontierSlope[t];
        if (old == newVal) return;
        frontierSlope[t] = newVal;
        if (old == 0 || newVal == 0) _syncAskBit(t);
    }

    function _syncAskBit(int24 t) internal {
        bool set = frontierDelta[t] != 0 || frontierSlope[t] != 0;
        int24 c = t / tickSpacing; // exact: t is always spacing-aligned
        int16 wordPos = int16(c >> 8);
        uint8 bitPos = uint8(uint24(c)); // low 8 bits, two's complement safe
        uint256 word = tickBitmap[wordPos];
        uint256 mask = uint256(1) << bitPos;
        if (set) {
            if (word & mask == 0) {
                tickBitmap[wordPos] = word | mask;
                if (word == 0) _syncTopBit(tickBitmapTop, wordPos, true);
            }
        } else {
            if (word & mask != 0) {
                uint256 nw = word & ~mask;
                tickBitmap[wordPos] = nw;
                if (nw == 0) _syncTopBit(tickBitmapTop, wordPos, false);
            }
        }
    }

    /// @dev Smallest spacing-aligned t in [fromT, maxT] with nonzero delta.
    /// Reads the starting fine word, then jumps via the top bitmap straight
    /// to the next NONZERO fine word — empty gaps cost one top-word SLOAD
    /// per 65,536 fine ticks, and fine words are only read where endpoints
    /// exist.
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
            (int24 nextWord, bool ok) = _nextDirtyWord(tickBitmapTop, int24(wordPos) + 1, cMax >> 8);
            if (!ok) return (0, false);
            c = nextWord * 256;
        }
        return (0, false);
    }

    /// @dev Smallest fine-word index in [fromW, maxW] whose top bit is set
    /// (i.e. whose fine word is nonzero). Same word/bit walk, one level up.
    function _nextDirtyWord(mapping(int16 => uint256) storage top, int24 fromW, int24 maxW)
        private
        view
        returns (int24, bool)
    {
        int24 w = fromW;
        while (w <= maxW) {
            int16 topPos = int16(w >> 8);
            uint8 bitPos = uint8(uint24(w));
            uint256 word = top[topPos] >> bitPos;
            if (word != 0) {
                int24 found = w + int24(uint24(_lsb(word)));
                if (found > maxW) return (0, false);
                return (found, true);
            }
            w = (int24(topPos) + 1) * 256;
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

    /// @dev Frontier = highest boundary covered by any up-sweep since the
    /// position's deposit, clamped to its range (prefix-contiguity makes the
    /// clamp exact). O(log sweep-records).
    function _frontier(Position storage p) internal view returns (int24 lo) {
        lo = p.claimedUpper;
        int24 hw = _highSince(p.depositClock);
        if (hw > lo) lo = hw > p.upper ? p.upper : hw;
    }

    /// @dev Highest boundary covered by a liquidity-moving up-sweep with
    /// clock > c. Entries: clocks ascending, highs strictly descending, so
    /// the first entry past c carries the maximum.
    function _highSince(uint64 c) internal view returns (int24) {
        uint256 n = _highWaters.length;
        uint256 lo = 0;
        uint256 hi = n;
        while (lo < hi) {
            uint256 mid = (lo + hi) / 2;
            if (_highWaters[mid].clock > c) hi = mid;
            else lo = mid + 1;
        }
        if (lo == n) return type(int24).min;
        return _highWaters[lo].high;
    }

    function _pushHighWater(uint64 clock, int24 high) internal {
        uint256 n = _highWaters.length;
        while (n > 0 && _highWaters[n - 1].high <= high) {
            _highWaters.pop();
            n--;
        }
        _highWaters.push(HighWater({clock: clock, high: high}));
    }

    /// @dev Lowest boundary covered by a liquidity-moving down-sweep with
    /// clock > c. Entries: clocks ascending, lows strictly ascending, so
    /// the first entry past c carries the minimum.
    function _lowSince(uint64 c) internal view returns (int24) {
        uint256 n = _lowWaters.length;
        uint256 lo = 0;
        uint256 hi = n;
        while (lo < hi) {
            uint256 mid = (lo + hi) / 2;
            if (_lowWaters[mid].clock > c) hi = mid;
            else lo = mid + 1;
        }
        if (lo == n) return type(int24).max;
        return _lowWaters[lo].low;
    }

    function _pushLowWater(uint64 clock, int24 low) internal {
        uint256 n = _lowWaters.length;
        while (n > 0 && _lowWaters[n - 1].low >= low) {
            _lowWaters.pop();
            n--;
        }
        _lowWaters.push(LowWater({clock: clock, low: low}));
    }

    /// @dev Proceeds for the position's levels in [a, b): closed-form sum of
    /// size(j) * rate(tick(j)) — size linear in j, rate linear in tick, so
    /// the sum is a quadratic series, floored ONCE over the whole span (the
    /// single rounding is what makes O(1) payouts possible).
    /// rate(t) = 1e18 + t*1e15, same linear curve as RangeTakeProfitBook.
    function _spanAmt1(Position storage p, int24 a, int24 b) internal view virtual returns (uint256) {
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

    function _nextBoundaryAbove(int24 tick) internal view returns (int24) {
        int24 b = (tick / tickSpacing) * tickSpacing;
        if (b <= tick) b += tickSpacing;
        return b;
    }
}
