// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.26;

import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {IUnlockCallback} from "v4-core/interfaces/callback/IUnlockCallback.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "v4-core/types/PoolId.sol";
import {Currency, CurrencyLibrary} from "v4-core/types/Currency.sol";
import {BalanceDelta} from "v4-core/types/BalanceDelta.sol";
import {TickMath} from "v4-core/libraries/TickMath.sol";
import {SqrtPriceMath} from "v4-core/libraries/SqrtPriceMath.sol";
import {StateLibrary} from "v4-core/libraries/StateLibrary.sol";

import {IRangeOrderBook} from "./IRangeOrderBook.sol";
import {IERC20Minimal} from "./RangeTakeProfitBook.sol";

/// @title RangeTakeProfitHook — the fill-clock book as a Uniswap v4 hook
///
/// Same mechanism as RangeTakeProfitBook, but the buckets are REAL pool
/// liquidity owned by this hook: depositing adds liquidity per tick-spacing
/// interval above the current price; the swap that sweeps an interval IS the
/// fill (the AMM converts token0 -> token1 as price crosses); `afterSwap`
/// burns every fully-crossed bucket, takes the token1 out of the pool, stamps
/// the fill clock, and zeroes the bucket — so consumed liquidity is physically
/// gone before any later swap can reverse over it.
///
/// Registered hook permissions: AFTER_INITIALIZE | AFTER_SWAP only. No
/// liquidity-hook flags, so the hook's own modifyLiquidity calls do not
/// re-enter it.
///
/// Pool fee must be 0 for this prototype: per-liquidity fill proceeds are then
/// the deterministic getAmount1Delta over the interval, identical in every
/// lifecycle, so claims need no per-fill records (see DESIGN.md).
///
/// One hook instance serves one pool (bound at afterInitialize), which keeps
/// the IRangeOrderBook interface identical to the prototype book. moveTickTo
/// is retained as a price-limit swap helper so the same test suite drives the
/// AMM directly.
contract RangeTakeProfitHook is IRangeOrderBook, IUnlockCallback {
    using StateLibrary for IPoolManager;
    using PoolIdLibrary for PoolKey;
    using CurrencyLibrary for Currency;

    IPoolManager public immutable manager;

    PoolKey internal _poolKey;
    PoolId public poolId;
    bool public poolSet;
    int24 internal _spacing;
    int24 public lastTick;

    uint64 public fillClock;
    uint256 public nextPositionId = 1;

    struct IntervalState {
        uint128 totalLiquidity;
        uint64 lastFillClock;
    }

    struct Position {
        address owner;
        int24 lower;
        int24 upper;
        uint128 liquidity;
        uint64 depositClock;
        bool live;
    }

    mapping(int24 => IntervalState) public intervals;
    mapping(uint256 => Position) public positions;
    mapping(uint256 => mapping(int24 => bool)) public claimedInterval;

    event Deposit(uint256 indexed positionId, address indexed owner, int24 lower, int24 upper, uint128 liquidity);
    event IntervalFilled(int24 indexed lowerTick, uint128 liquidity, uint256 proceeds1, uint64 clock);
    event Claim(uint256 indexed positionId, uint256 proceeds1);
    event Cancel(uint256 indexed positionId, uint256 proceeds1, uint256 principal0);

    enum Action {
        DEPOSIT,
        CANCEL,
        CLAIM
    }

    struct Callback {
        Action action;
        address user;
        int24 a; // lower
        int24 b; // upper
        uint128 liquidity;
        uint64 depositClock; // CANCEL: position's clock
        uint256 amount1; // CLAIM: token1 owed
    }

    /// @dev v4's Hooks library skips hook callbacks when the hook itself is
    /// the swapper (noSelfCall), so the market helper must swap from a
    /// separate address for afterSwap to fire — exactly as it does for any
    /// real-world router.
    MarketSwapper public immutable swapper;

    constructor(IPoolManager _manager) {
        manager = _manager;
        swapper = new MarketSwapper(_manager);
    }

    modifier onlyManager() {
        require(msg.sender == address(manager), "not manager");
        _;
    }

    // ------------------------------------------------------------------
    // Hook callbacks (only the two registered ones are implemented)
    // ------------------------------------------------------------------

    function afterInitialize(address, PoolKey calldata key, uint160, int24 tick)
        external
        onlyManager
        returns (bytes4)
    {
        require(!poolSet, "pool already set");
        require(key.fee == 0, "fee must be 0");
        poolSet = true;
        _poolKey = key;
        poolId = key.toId();
        _spacing = key.tickSpacing;
        lastTick = tick;
        return IHooks.afterInitialize.selector;
    }

    function afterSwap(address, PoolKey calldata, IPoolManager.SwapParams calldata, BalanceDelta, bytes calldata)
        external
        onlyManager
        returns (bytes4, int128)
    {
        (, int24 tickNow,,) = manager.getSlot0(poolId);
        _settleCrossings(tickNow);
        return (IHooks.afterSwap.selector, 0);
    }

    /// @dev Burn every bucket whose upper boundary lies in (lastTick, tickNow].
    /// Runs inside the manager's unlock context (afterSwap), so the hook can
    /// modify liquidity and take its proceeds directly.
    function _settleCrossings(int24 tickNow) internal {
        int24 old = lastTick;
        lastTick = tickNow;
        if (tickNow <= old) return;

        uint256 take0;
        uint256 take1;
        for (int24 u = _nextBoundaryAbove(old); u <= tickNow; u += _spacing) {
            int24 lower = u - _spacing;
            IntervalState storage s = intervals[lower];
            uint128 liq = s.totalLiquidity;
            if (liq == 0) continue;

            s.totalLiquidity = 0;
            uint64 clock = ++fillClock;
            s.lastFillClock = clock;

            (BalanceDelta delta,) = manager.modifyLiquidity(
                _poolKey,
                IPoolManager.ModifyLiquidityParams({
                    tickLower: lower,
                    tickUpper: u,
                    liquidityDelta: -int256(uint256(liq)),
                    salt: bytes32(0)
                }),
                ""
            );
            // Fully below price: the burn yields token1 only (amount0 == 0).
            if (delta.amount0() > 0) take0 += uint256(uint128(delta.amount0()));
            if (delta.amount1() > 0) take1 += uint256(uint128(delta.amount1()));
            emit IntervalFilled(lower, liq, uint256(uint128(delta.amount1())), clock);
        }
        // afterSwap runs BEFORE the swapper settles, so the manager may not
        // hold the real tokens yet — mint ERC-6909 claims instead and redeem
        // them for real tokens at user-claim time.
        if (take0 > 0) manager.mint(address(this), _poolKey.currency0.toId(), take0);
        if (take1 > 0) manager.mint(address(this), _poolKey.currency1.toId(), take1);
    }

    // ------------------------------------------------------------------
    // Orders
    // ------------------------------------------------------------------

    function deposit(int24 lower, int24 upper, uint128 liquidity) external returns (uint256 positionId) {
        require(poolSet, "no pool");
        require(liquidity > 0, "zero liquidity");
        require(lower < upper, "empty range");
        require(lower % _spacing == 0 && upper % _spacing == 0, "unaligned");
        (, int24 cur,,) = manager.getSlot0(poolId);
        require(lower > cur, "range not above price");

        for (int24 t = lower; t < upper; t += _spacing) {
            intervals[t].totalLiquidity += liquidity;
        }

        positionId = nextPositionId++;
        positions[positionId] = Position({
            owner: msg.sender,
            lower: lower,
            upper: upper,
            liquidity: liquidity,
            depositClock: fillClock,
            live: true
        });

        manager.unlock(
            abi.encode(
                Callback({
                    action: Action.DEPOSIT,
                    user: msg.sender,
                    a: lower,
                    b: upper,
                    liquidity: liquidity,
                    depositClock: 0,
                    amount1: 0
                })
            )
        );
        emit Deposit(positionId, msg.sender, lower, upper, liquidity);
    }

    function claim(uint256 positionId) public returns (uint256 proceeds1) {
        Position storage p = positions[positionId];
        require(p.live, "not live");
        require(msg.sender == p.owner, "not owner");

        for (int24 t = p.lower; t < p.upper; t += _spacing) {
            if (claimedInterval[positionId][t]) continue;
            if (intervals[t].lastFillClock > p.depositClock) {
                claimedInterval[positionId][t] = true;
                proceeds1 += _amt1(t, p.liquidity);
            }
        }

        if (proceeds1 > 0) {
            manager.unlock(
                abi.encode(
                    Callback({
                        action: Action.CLAIM,
                        user: p.owner,
                        a: 0,
                        b: 0,
                        liquidity: 0,
                        depositClock: 0,
                        amount1: proceeds1
                    })
                )
            );
        }
        emit Claim(positionId, proceeds1);
    }

    function cancel(uint256 positionId) external returns (uint256 proceeds1, uint256 principal0) {
        proceeds1 = claim(positionId); // checks live + owner

        Position storage p = positions[positionId];
        p.live = false;

        bytes memory result = manager.unlock(
            abi.encode(
                Callback({
                    action: Action.CANCEL,
                    user: p.owner,
                    a: p.lower,
                    b: p.upper,
                    liquidity: p.liquidity,
                    depositClock: p.depositClock,
                    amount1: 0
                })
            )
        );
        (uint256 got0, uint256 got1) = abi.decode(result, (uint256, uint256));
        principal0 = got0;
        // got1 > 0 only if the position's lowest unfilled interval currently
        // straddles the price: its partially-converted token1 comes back too.
        proceeds1 += got1;
        emit Cancel(positionId, proceeds1, principal0);
    }

    /// @notice Test/market helper: swap along the pool until price reaches
    /// exactly `target`. Caller pays the input currency (must have approved
    /// the swapper) and receives the output. Fills happen through the hook's
    /// afterSwap, as they would for any external swap.
    function moveTickTo(int24 target) external {
        require(poolSet, "no pool");
        (, int24 cur,,) = manager.getSlot0(poolId);
        if (target == cur) return;
        swapper.swapToTick(_poolKey, target, msg.sender);
    }

    // ------------------------------------------------------------------
    // Unlock callback
    // ------------------------------------------------------------------

    function unlockCallback(bytes calldata raw) external onlyManager returns (bytes memory) {
        Callback memory cb = abi.decode(raw, (Callback));

        if (cb.action == Action.DEPOSIT) {
            uint256 owed0;
            for (int24 t = cb.a; t < cb.b; t += _spacing) {
                (BalanceDelta delta,) = manager.modifyLiquidity(
                    _poolKey,
                    IPoolManager.ModifyLiquidityParams({
                        tickLower: t,
                        tickUpper: t + _spacing,
                        liquidityDelta: int256(uint256(cb.liquidity)),
                        salt: bytes32(0)
                    }),
                    ""
                );
                owed0 += uint256(uint128(-delta.amount0()));
            }
            _payToPool(_poolKey.currency0, cb.user, owed0);
            return "";
        }

        if (cb.action == Action.CLAIM) {
            // redeem 6909 claims minted at fill time for real token1
            manager.burn(address(this), _poolKey.currency1.toId(), cb.amount1);
            manager.take(_poolKey.currency1, cb.user, cb.amount1);
            return "";
        }

        // Action.CANCEL
        uint256 take0;
        uint256 take1;
        for (int24 t = cb.a; t < cb.b; t += _spacing) {
            if (intervals[t].lastFillClock > cb.depositClock) continue; // consumed, nothing here
            intervals[t].totalLiquidity -= cb.liquidity;
            (BalanceDelta delta,) = manager.modifyLiquidity(
                _poolKey,
                IPoolManager.ModifyLiquidityParams({
                    tickLower: t,
                    tickUpper: t + _spacing,
                    liquidityDelta: -int256(uint256(cb.liquidity)),
                    salt: bytes32(0)
                }),
                ""
            );
            if (delta.amount0() > 0) take0 += uint256(uint128(delta.amount0()));
            if (delta.amount1() > 0) take1 += uint256(uint128(delta.amount1()));
        }
        if (take0 > 0) manager.take(_poolKey.currency0, cb.user, take0);
        if (take1 > 0) manager.take(_poolKey.currency1, cb.user, take1);
        return abi.encode(take0, take1);
    }

    function _payToPool(Currency currency, address payer, uint256 amount) internal {
        if (amount == 0) return;
        manager.sync(currency);
        require(IERC20Minimal(Currency.unwrap(currency)).transferFrom(payer, address(manager), amount), "pay failed");
        manager.settle();
    }

    // ------------------------------------------------------------------
    // Views
    // ------------------------------------------------------------------

    function currentTick() external view returns (int24) {
        (, int24 tick,,) = manager.getSlot0(poolId);
        return tick;
    }

    function activeLiquidity(int24 lowerTick) external view returns (uint128) {
        return intervals[lowerTick].totalLiquidity;
    }

    function claimable(uint256 positionId) external view returns (uint256 proceeds1) {
        Position storage p = positions[positionId];
        if (!p.live) return 0;
        for (int24 t = p.lower; t < p.upper; t += _spacing) {
            if (claimedInterval[positionId][t]) continue;
            if (intervals[t].lastFillClock > p.depositClock) {
                proceeds1 += _amt1(t, p.liquidity);
            }
        }
    }

    function unfilledPrincipal(uint256 positionId) external view returns (uint256 principal0) {
        Position storage p = positions[positionId];
        if (!p.live) return 0;
        for (int24 t = p.lower; t < p.upper; t += _spacing) {
            if (intervals[t].lastFillClock <= p.depositClock) {
                principal0 += _amt0(t, p.liquidity);
            }
        }
    }

    function isConsumedFor(uint256 positionId, int24 lowerTick) external view returns (bool) {
        Position storage p = positions[positionId];
        return claimedInterval[positionId][lowerTick] || intervals[lowerTick].lastFillClock > p.depositClock;
    }

    // ------------------------------------------------------------------
    // Real tick math replaces the prototype's linear curve
    // ------------------------------------------------------------------

    function _amt1(int24 lower, uint128 liquidity) internal view returns (uint256) {
        return SqrtPriceMath.getAmount1Delta(
            TickMath.getSqrtPriceAtTick(lower), TickMath.getSqrtPriceAtTick(lower + _spacing), liquidity, false
        );
    }

    function _amt0(int24 lower, uint128 liquidity) internal view returns (uint256) {
        return SqrtPriceMath.getAmount0Delta(
            TickMath.getSqrtPriceAtTick(lower), TickMath.getSqrtPriceAtTick(lower + _spacing), liquidity, false
        );
    }

    function _nextBoundaryAbove(int24 tick) internal view returns (int24) {
        int24 b = (tick / _spacing) * _spacing;
        if (b <= tick) b += _spacing;
        return b;
    }
}

/// @notice Minimal price-limit swap router for the market/test side. Lives at
/// its own address so the pool's hook callbacks fire normally (v4 suppresses
/// callbacks for swaps initiated by the hook itself).
contract MarketSwapper is IUnlockCallback {
    using StateLibrary for IPoolManager;
    using PoolIdLibrary for PoolKey;

    IPoolManager public immutable manager;

    constructor(IPoolManager _manager) {
        manager = _manager;
    }

    function swapToTick(PoolKey memory key, int24 target, address payer) external {
        manager.unlock(abi.encode(key, target, payer));
    }

    function unlockCallback(bytes calldata raw) external returns (bytes memory) {
        require(msg.sender == address(manager), "not manager");
        (PoolKey memory key, int24 target, address payer) = abi.decode(raw, (PoolKey, int24, address));

        (, int24 cur,,) = manager.getSlot0(key.toId());
        BalanceDelta d = manager.swap(
            key,
            IPoolManager.SwapParams({
                zeroForOne: target < cur,
                amountSpecified: -int256(1e30), // exact-input "as much as needed"
                sqrtPriceLimitX96: TickMath.getSqrtPriceAtTick(target)
            }),
            ""
        );

        if (d.amount0() < 0) _payToPool(key.currency0, payer, uint256(uint128(-d.amount0())));
        if (d.amount1() < 0) _payToPool(key.currency1, payer, uint256(uint128(-d.amount1())));
        if (d.amount0() > 0) manager.take(key.currency0, payer, uint256(uint128(d.amount0())));
        if (d.amount1() > 0) manager.take(key.currency1, payer, uint256(uint128(d.amount1())));
        return "";
    }

    function _payToPool(Currency currency, address payer, uint256 amount) internal {
        manager.sync(currency);
        require(IERC20Minimal(Currency.unwrap(currency)).transferFrom(payer, address(manager), amount), "pay failed");
        manager.settle();
    }
}
