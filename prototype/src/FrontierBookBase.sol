// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20Minimal} from "./RangeTakeProfitBook.sol";
import {IFrontierHooks, FrontierHookFlags} from "./hooks/IFrontierHooks.sol";
import {IPermissionRegistry} from "./permissions/interfaces/IPermissionRegistry.sol";

/// @title FrontierBookBase — storage layout + shared machinery of the book
///
/// EIP-170 split: the deployable book is two contracts sharing this exact
/// storage layout and immutable set. The book (the address users hold —
/// `UniformFrontierBook`, and the deployed `GeometricFrontierBook` that
/// extends it) keeps the hot path — deposits, sweeps, claims, views — and
/// forwards the cold maker-management surface (requotes, cancels,
/// transfers) to a maker-ops companion (`UniformMakerOps` /
/// `GeometricMakerOps`) via delegatecall. Because delegatecalled code reads
/// its OWN immutables, the companion is constructed with the same
/// (token0, token1, spacing, hooks, permissions) and can be shared by every
/// book with that config.
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
    /// fee recipient for this experimental branch; zero only when both fees are zero
    address public immutable feeRecipient;
    /// maker fee charged from claim proceeds, in basis points
    uint16 public immutable makerFeeBps;
    /// taker fee charged on sweep input, in basis points
    uint16 public immutable takerFeeBps;

    int24 internal _currentTick;
    uint64 public fillClock;
    uint64 internal _nextPositionId = 1;

    function nextPositionId() public view returns (uint256) {
        return _nextPositionId;
    }

    // signed: +L at live frontiers, -L at order uppers; rolls self-cancel
    mapping(int24 => int256) public frontierDelta;
    // one bit per tick-spacing interval with nonzero frontierDelta, so sweeps
    // skip empty price regions in O(1) per 256 intervals instead of one SLOAD
    // per interval (which would brick sweeps across wide gaps)
    mapping(int16 => uint256) public tickBitmap;

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
    int24 internal _minBoundary = type(int24).max;
    int24 internal _maxBoundary = type(int24).min;

    struct Position {
        address owner;
        int24 lower;
        int24 upper;
        // asks: proceeds paid for [lower, cursor); bids: paid for [cursor, upper)
        int24 claimedUpper;
        bool live;
        bool isBid;
        uint128 liquidity; // size at every covered level (uniform ladder)
        uint64 depositClock;
    }

    mapping(uint256 => Position) internal _positions;

    function positions(uint256 positionId)
        public
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
        )
    {
        Position storage p = _positions[positionId];
        return (
            p.owner,
            p.lower,
            p.upper,
            p.liquidity,
            p.depositClock,
            p.claimedUpper,
            p.live,
            p.isBid
        );
    }

    function _storePosition(
        uint256 positionId,
        address owner,
        int24 lower,
        int24 upper,
        uint128 liquidity,
        uint64 depositClock,
        int24 claimedUpper,
        bool isBid
    ) internal {
        uint256 word0 = uint256(uint160(owner)) | (uint256(uint24(lower)) << 160) | (uint256(uint24(upper)) << 184)
            | (uint256(uint24(claimedUpper)) << 208) | (uint256(1) << 232) | (isBid ? (uint256(1) << 240) : 0);
        uint256 word1 = uint256(liquidity) | (uint256(depositClock) << 128);
        assembly ("memory-safe") {
            mstore(0, positionId)
            mstore(32, _positions.slot)
            let slot := keccak256(0, 64)
            sstore(slot, word0)
            sstore(add(slot, 1), word1)
        }
    }

    // Internal balance ledger: kept for storage-layout compatibility; no
    // public-facing accumulation paths exist in the deploy-facing book.
    mapping(address => uint256) internal internalBalance0;
    mapping(address => uint256) internal internalBalance1;

    // Shadow liquidity: pooled inventory that can mirror real fills up to
    // the real amount a taker crosses, without adding independent price
    // discovery to the book.
    uint256 internal shadowReserve0;
    uint256 internal shadowReserve1;
    uint256 internal shadowTotalShares;
    mapping(address => uint256) internal shadowShares;

    event Deposit(uint256 indexed positionId, address indexed owner, int24 lower, int24 upper, uint128 liquidity);
    event IntervalFilled(int24 indexed lowerTick, uint128 liquidity, uint256 proceeds1, uint64 clock);
    event RunFilled(int24 indexed fromLevel, int24 toBoundary, uint256 startSize, uint64 clock);
    event Claim(uint256 indexed positionId, uint256 proceeds1);
    event Cancel(uint256 indexed positionId, uint256 proceeds1, uint256 principal0);
    event Requote(uint256 indexed positionId, int24 lower, int24 upper, uint128 liquidity);
    event PositionTransferred(uint256 indexed positionId, address indexed from, address indexed to);
    event MakerFee(
        uint256 indexed positionId,
        address indexed token,
        uint256 grossProceeds,
        uint256 fee,
        uint256 netProceeds,
        address recipient
    );
    event TakerFee(
        address indexed payer,
        address indexed token,
        uint256 grossInput,
        uint256 fee,
        uint256 totalPaid,
        address recipient
    );
    event ShadowDeposit(address indexed user, uint256 amount0, uint256 amount1, uint256 shares);
    event ShadowWithdraw(address indexed user, uint256 amount0, uint256 amount1, uint256 shares);

    uint256 internal constant PRICE_SCALE = 1e18;
    uint256 public constant FEE_BPS_DENOMINATOR = 10_000;
    uint16 public constant MAX_FEE_BPS = 1_000;

    constructor(
        address _token0,
        address _token1,
        int24 _tickSpacing,
        int24 _initialTick,
        address _hooks,
        address _permissions,
        address _feeRecipient,
        uint16 _makerFeeBps,
        uint16 _takerFeeBps
    ) {
        require(_tickSpacing > 0, "bad spacing");
        require(_makerFeeBps <= MAX_FEE_BPS && _takerFeeBps <= MAX_FEE_BPS, "fee too high");
        require(_feeRecipient != address(0) || (_makerFeeBps == 0 && _takerFeeBps == 0), "fee recipient required");
        token0 = IERC20Minimal(_token0);
        token1 = IERC20Minimal(_token1);
        tickSpacing = _tickSpacing;
        _currentTick = _initialTick;
        hooks = IFrontierHooks(_hooks);
        permissions = IPermissionRegistry(_permissions);
        feeRecipient = _feeRecipient;
        makerFeeBps = _makerFeeBps;
        takerFeeBps = _takerFeeBps;
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
    // Hook dispatch (skipped when the hook itself is the caller)
    // ------------------------------------------------------------------

    function _callHook(uint160 flag, bytes memory data, bytes4 expected) internal {
        address h = address(hooks);
        if (h == address(0) || !h.hasFlag(flag) || msg.sender == h) return;
        (bool ok, bytes memory ret) = h.call(data);
        require(ok && ret.length >= 32 && abi.decode(ret, (bytes4)) == expected, "hook rejected");
    }

    function _callBeforeDepositHook(
        address owner,
        int24 lower,
        int24 upper,
        uint128 liquidity,
        bool isBid
    ) internal {
        address h = address(hooks);
        if (h == address(0) || !h.hasFlag(FrontierHookFlags.BEFORE_DEPOSIT_FLAG) || msg.sender == h) return;
        (bool ok, bytes memory ret) =
            h.call(abi.encodeCall(IFrontierHooks.beforeDeposit, (owner, lower, upper, liquidity, isBid)));
        require(
            ok && ret.length >= 32 && abi.decode(ret, (bytes4)) == IFrontierHooks.beforeDeposit.selector,
            "hook rejected"
        );
    }

    function _callAfterDepositHook(address owner, uint256 positionId, bool isBid) internal {
        address h = address(hooks);
        if (h == address(0) || !h.hasFlag(FrontierHookFlags.AFTER_DEPOSIT_FLAG) || msg.sender == h) return;
        (bool ok, bytes memory ret) = h.call(abi.encodeCall(IFrontierHooks.afterDeposit, (owner, positionId, isBid)));
        require(
            ok && ret.length >= 32 && abi.decode(ret, (bytes4)) == IFrontierHooks.afterDeposit.selector, "hook rejected"
        );
    }

    // ------------------------------------------------------------------
    // Shared internals
    // ------------------------------------------------------------------

    function _checkRange(int24 lower, int24 upper) internal view {
        require(lower < upper, "empty range");
        require(lower % tickSpacing == 0 && upper % tickSpacing == 0, "unaligned");
        require(lower > _currentTick, "range not above price");
    }

    function _levels(int24 lower, int24 upper) internal view returns (uint24) {
        return uint24(upper - lower) / uint24(tickSpacing);
    }

    function _levelOf(Position storage p, int24 t) internal view returns (uint24) {
        return uint24(t - p.lower) / uint24(tickSpacing);
    }

    // ------------------------------------------------------------------
    // UNIFORM ask helpers: every covered level rests the same `liquidity`,
    // so the book links only two endpoint writes per order regardless of
    // width and the value bitmap alone drives sweeps.
    // ------------------------------------------------------------------

    /// @dev Endpoint write keeping the ask bitmap in sync against
    /// frontierDelta: every covered level carries nonzero frontierDelta after
    /// the roll, so the bit is set iff frontierDelta != 0.
    function _writeFlatDelta(int24 t, int256 newVal) internal {
        int256 old = frontierDelta[t];
        if (old == newVal) return;
        frontierDelta[t] = newVal;
        if (old == 0 || newVal == 0) {
            int24 c = t / tickSpacing; // exact: t is always spacing-aligned
            int16 wordPos = int16(c >> 8);
            uint8 bitPos = uint8(uint24(c));
            if (newVal != 0) tickBitmap[wordPos] |= (uint256(1) << bitPos);
            else tickBitmap[wordPos] &= ~(uint256(1) << bitPos);
        }
    }

    /// @dev Two endpoint writes, size `liquidity` at every covered level.
    function _addFlatOrder(int24 lower, int24 upper, uint128 liquidity) internal {
        int256 liq = int256(uint256(liquidity));
        _writeFlatDelta(lower, frontierDelta[lower] + liq);
        _writeFlatDelta(upper, frontierDelta[upper] - liq);
        if (lower < _minBoundary) _minBoundary = lower;
    }

    /// @dev Every covered level holds the same `liquidity`, so the remaining
    /// tail [frontier, upper) is just -liq at the frontier and +liq at the
    /// upper.
    function _removeFlatOrderAt(int24 frontier, int24 upper, uint128 liquidity) internal {
        int256 liq = int256(uint256(liquidity));
        _writeFlatDelta(frontier, frontierDelta[frontier] - liq);
        _writeFlatDelta(upper, frontierDelta[upper] + liq);
    }

    /// @dev Uniform ask run [e, e+n*s): token0 sold and token1 collected
    /// (ceil, contract-favorable) for `n` levels of constant size `a0`.
    /// Virtual so the curve mixin swaps in its closed form.
    function _askRun(int24 e, int256 a0, uint256 n) internal view virtual returns (uint256 out0, uint256 cost1) {
        require(a0 >= 0, "negative run");
        int256 ni = int256(n);
        int256 sumK = (ni * (ni - 1)) / 2;
        int256 c0 = int256(PRICE_SCALE) + int256(e) * 1e15;
        int256 c1 = int256(tickSpacing) * 1e15;
        int256 val = a0 * c0 * ni + a0 * c1 * sumK;
        require(val >= 0, "negative run");
        out0 = uint256(a0 * ni);
        cost1 = (uint256(val) + PRICE_SCALE - 1) / PRICE_SCALE;
    }

    /// @dev Uniform claim span: token1 proceeds (floor) for the position's
    /// levels in [a, b) at constant size p.liquidity. Virtual so the curve
    /// mixin swaps its form.
    function _askSpan(Position storage p, int24 a, int24 b) internal view virtual returns (uint256) {
        int256 sp = int256(tickSpacing);
        int256 ja = (int256(a) - int256(p.lower)) / sp;
        int256 n = (int256(b) - int256(a)) / sp;
        int256 jb = ja + n; // exclusive
        int256 sj = ((ja + jb - 1) * n) / 2;
        int256 l0 = int256(uint256(p.liquidity));
        int256 c0 = int256(PRICE_SCALE) + int256(p.lower) * 1e15;
        int256 c1 = sp * 1e15;
        int256 total = l0 * c0 * n + l0 * c1 * sj;
        require(total >= 0, "rate underflow");
        return uint256(total) / PRICE_SCALE;
    }

    function _addBid(int24 lower, int24 upper, uint128 liquidity) internal {
        int24 upperT = upper - tickSpacing;
        int24 lowerT = lower - tickSpacing;
        int256 liq = int256(uint256(liquidity));
        int256 oldUpper = bidDelta[upperT];
        int256 newUpper = oldUpper + liq;
        int256 oldLower = bidDelta[lowerT];
        int256 newLower = oldLower - liq;
        bidDelta[upperT] = newUpper;
        bidDelta[lowerT] = newLower;
        if (oldUpper == 0 && oldLower == 0) {
            int24 cUpper = upperT / tickSpacing;
            int24 cLower = lowerT / tickSpacing;
            int16 wordUpper = int16(cUpper >> 8);
            uint256 maskUpper = uint256(1) << uint8(uint24(cUpper));
            uint256 maskLower = uint256(1) << uint8(uint24(cLower));
            int16 wordLower = int16(cLower >> 8);
            if (wordUpper == wordLower) {
                bidBitmap[wordUpper] |= maskUpper | maskLower;
            } else {
                bidBitmap[wordUpper] |= maskUpper;
                bidBitmap[wordLower] |= maskLower;
            }
            return;
        }
        _syncBidBitsAfterTwo(upperT, oldUpper, newUpper, lowerT, oldLower, newLower);
    }

    function _syncBidBitsAfterTwo(int24 a, int256 oldA, int256 newA, int24 b, int256 oldB, int256 newB) internal {
        bool touchA = oldA == 0 || newA == 0;
        bool touchB = oldB == 0 || newB == 0;
        if (!touchA && !touchB) return;

        int24 cA = a / tickSpacing;
        int16 wordA = int16(cA >> 8);
        uint256 maskA = uint256(1) << uint8(uint24(cA));
        if (touchB) {
            int24 cB = b / tickSpacing;
            int16 wordB = int16(cB >> 8);
            uint256 maskB = uint256(1) << uint8(uint24(cB));
            if (wordA == wordB) {
                uint256 word = bidBitmap[wordA];
                if (touchA) word = newA != 0 ? word | maskA : word & ~maskA;
                word = newB != 0 ? word | maskB : word & ~maskB;
                bidBitmap[wordA] = word;
                return;
            }
            if (touchA) _syncBidBit(wordA, maskA, newA != 0);
            _syncBidBit(wordB, maskB, newB != 0);
            return;
        }
        _syncBidBit(wordA, maskA, newA != 0);
    }

    function _syncBidBit(int16 wordPos, uint256 mask, bool set) internal {
        uint256 word = bidBitmap[wordPos];
        if (set) {
            if (word & mask == 0) bidBitmap[wordPos] = word | mask;
        } else {
            if (word & mask != 0) bidBitmap[wordPos] = word & ~mask;
        }
    }

    /// @dev Bid mirror of _writeDelta, maintaining the bid bitmap.
    function _writeBidDelta(int24 t, int256 newVal) internal {
        int256 old = bidDelta[t];
        if (old == newVal) return;
        bidDelta[t] = newVal;
        if (old == 0 || newVal == 0) {
            int24 c = t / tickSpacing;
            int16 wordPos = int16(c >> 8);
            uint8 bitPos = uint8(uint24(c));
            if (newVal != 0) bidBitmap[wordPos] |= (uint256(1) << bitPos);
            else bidBitmap[wordPos] &= ~(uint256(1) << bitPos);
        }
    }

    /// @dev Largest spacing-aligned t in [minT, fromT] with nonzero bidDelta,
    /// scanning whole bitmap words downward.
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
            c = (int24(wordPos) * 256) - 1;
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
        unchecked {
            int256 sp = int256(tickSpacing);
            int256 n = (int256(b) - int256(a)) / sp;
            int256 tickSum = n * int256(a) + (sp * n * (n - 1)) / 2;
            int256 rateSum = n * int256(PRICE_SCALE) + tickSum * 1e15;
            require(rateSum > 0, "rate underflow");
            uint256 v = uint256(size) * uint256(rateSum);
            return roundUp ? (v + PRICE_SCALE - 1) / PRICE_SCALE : v / PRICE_SCALE;
        }
    }

    function _rate(int24 t) internal pure virtual returns (uint256) {
        int256 r = int256(PRICE_SCALE) + int256(t) * 1e15;
        require(r > 0, "rate underflow");
        return uint256(r);
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

    function _pull0(address payer, uint256 amount) internal {
        _transferInExact(token0, payer, amount, "non-exact token0 transfer");
    }

    function _pull1(address payer, uint256 amount) internal {
        _transferInExact(token1, payer, amount, "non-exact token1 transfer");
    }

    function _transferInExact(IERC20Minimal token, address payer, uint256 amount, string memory err) internal {
        if (amount == 0) return;
        uint256 beforeBal = token.balanceOf(address(this));
        require(token.transferFrom(payer, address(this), amount), "transfer in failed");
        require(token.balanceOf(address(this)) - beforeBal == amount, err);
    }

    function _feeAmount(uint256 amount, uint16 feeBps) internal pure returns (uint256) {
        return (amount * feeBps) / FEE_BPS_DENOMINATOR;
    }

    function _maxGrossForTotal(uint256 maxTotal, uint16 feeBps) internal pure returns (uint256) {
        if (feeBps == 0 || maxTotal == type(uint256).max) return maxTotal;
        uint256 denominator = FEE_BPS_DENOMINATOR + uint256(feeBps);
        return
            (maxTotal / denominator) * FEE_BPS_DENOMINATOR + ((maxTotal % denominator) * FEE_BPS_DENOMINATOR)
                / denominator;
    }

    function _chargeMakerFee(IERC20Minimal token, uint256 positionId, uint256 grossProceeds)
        internal
        returns (uint256 netProceeds, uint256 fee)
    {
        fee = _feeAmount(grossProceeds, makerFeeBps);
        netProceeds = grossProceeds - fee;
        if (fee > 0) require(token.transfer(feeRecipient, fee), "fee transfer failed");
        if (makerFeeBps > 0) emit MakerFee(positionId, address(token), grossProceeds, fee, netProceeds, feeRecipient);
    }

    function _takerTotal(uint256 grossInput) internal view returns (uint256 totalPaid, uint256 fee) {
        fee = _feeAmount(grossInput, takerFeeBps);
        totalPaid = grossInput + fee;
    }

    function _payTakerFee(IERC20Minimal token, address payer, uint256 grossInput, uint256 fee, uint256 totalPaid)
        internal
    {
        if (fee > 0) require(token.transfer(feeRecipient, fee), "fee transfer failed");
        if (takerFeeBps > 0) emit TakerFee(payer, address(token), grossInput, fee, totalPaid, feeRecipient);
    }

    /// @dev Single write path for the ask ledger, keeping the bitmap in sync.
    /// Bit set <=> frontierDelta != 0 — runs telescope between set bits.
    function _writeDelta(int24 t, int256 newVal) internal {
        int256 old = frontierDelta[t];
        if (old == newVal) return;
        frontierDelta[t] = newVal;
        if (old == 0 || newVal == 0) _syncAskBit(t);
    }

    function _syncAskBit(int24 t) internal {
        bool set = frontierDelta[t] != 0;
        int24 c = t / tickSpacing; // exact: t is always spacing-aligned
        int16 wordPos = int16(c >> 8);
        uint8 bitPos = uint8(uint24(c)); // low 8 bits, two's complement safe
        uint256 word = tickBitmap[wordPos];
        uint256 mask = uint256(1) << bitPos;
        if (set) {
            if (word & mask == 0) tickBitmap[wordPos] = word | mask;
        } else {
            if (word & mask != 0) tickBitmap[wordPos] = word & ~mask;
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

    function _nextBoundaryAbove(int24 tick) internal view returns (int24) {
        int24 b = (tick / tickSpacing) * tickSpacing;
        if (b <= tick) b += tickSpacing;
        return b;
    }
}
