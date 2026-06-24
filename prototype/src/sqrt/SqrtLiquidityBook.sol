// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.24;

import {IERC20Minimal} from "../RangeTakeProfitBook.sol";
import {SqrtLiquidityMath as M} from "./SqrtLiquidityMath.sol";

/// @title SqrtLiquidityBook — proof-of-concept: currency-neutral L-sizing
///
/// A position is `(tickLower, tickUpper, L)`. The maker never picks a numeraire:
/// `L` is the geometric-mean size, and which token they escrow is derived from
/// the side. An ASK escrows the token0 leg `L/sqrtP`; a BID escrows the token1
/// leg `L*sqrtP`. Because the bid is the ask reflected (`leg0(t) == leg1(-t)`),
/// both sides are the SAME path with the legs swapped — there is no bid mirror.
///
/// POC scope: single-position atomic fills (no partial fills, no price-ordering
/// engine, no fees). The O(1) frontier sweep / bitmap / high-water machinery
/// from the production book carries over unchanged, because every amount here
/// is a difference of sqrtP endpoints over a shared denominator — the same
/// telescoping shape the geometric value book already sweeps in O(1).
contract SqrtLiquidityBook {
    IERC20Minimal public immutable token0;
    IERC20Minimal public immutable token1;
    int24 public immutable tickSpacing;

    struct Position {
        address owner;
        int24 tickLower;
        int24 tickUpper;
        uint128 L;
        bool isAsk; // escrows token0 (true) or token1 (false)
        bool live;
        uint256 escrowed; // the leg amount actually pulled
    }

    mapping(uint256 => Position) public positions;
    uint256 public nextId = 1;

    event Provided(uint256 indexed id, address indexed owner, bool isAsk, uint128 L, uint256 escrowed);
    event Taken(uint256 indexed id, address indexed taker, uint256 paid, uint256 received);
    event Cancelled(uint256 indexed id, uint256 refunded);

    constructor(address _token0, address _token1, int24 _tickSpacing) {
        require(_tickSpacing > 0, "bad spacing");
        token0 = IERC20Minimal(_token0);
        token1 = IERC20Minimal(_token1);
        tickSpacing = _tickSpacing;
    }

    function _checkRange(int24 lower, int24 upper) internal view {
        require(lower < upper, "empty range");
        require(lower % tickSpacing == 0 && upper % tickSpacing == 0, "unaligned");
    }

    // ---- maker: provide L; the escrow token is DERIVED, not chosen ----

    /// @notice Sell token0 across [lower, upper) sized by liquidity L. Escrows
    /// the token0 leg (ceil; book-favorable).
    function provideAsk(int24 lower, int24 upper, uint128 L) external returns (uint256 id) {
        require(L > 0, "zero L");
        _checkRange(lower, upper);
        uint256 amount0 = M.amount0Range(lower, upper, tickSpacing, L, true);
        require(token0.transferFrom(msg.sender, address(this), amount0), "pull0");
        id = nextId++;
        positions[id] = Position(msg.sender, lower, upper, L, true, true, amount0);
        emit Provided(id, msg.sender, true, L, amount0);
    }

    /// @notice Buy token0 across [lower, upper) sized by the SAME L. Escrows the
    /// token1 leg (ceil). Identical code to provideAsk with the leg swapped.
    function provideBid(int24 lower, int24 upper, uint128 L) external returns (uint256 id) {
        require(L > 0, "zero L");
        _checkRange(lower, upper);
        uint256 amount1 = M.amount1Range(lower, upper, tickSpacing, L, true);
        require(token1.transferFrom(msg.sender, address(this), amount1), "pull1");
        id = nextId++;
        positions[id] = Position(msg.sender, lower, upper, L, false, true, amount1);
        emit Provided(id, msg.sender, false, L, amount1);
    }

    // ---- taker: hit a position; atomic conversion at the range's price ----

    /// @notice Take an ask: pay the token1 leg, receive the escrowed token0.
    function takeAsk(uint256 id) external returns (uint256 paid1, uint256 got0) {
        Position storage p = positions[id];
        require(p.live && p.isAsk, "not takeable");
        paid1 = M.amount1Range(p.tickLower, p.tickUpper, tickSpacing, p.L, true);
        got0 = p.escrowed;
        p.live = false;
        require(token1.transferFrom(msg.sender, p.owner, paid1), "pay1");
        require(token0.transfer(msg.sender, got0), "send0");
        emit Taken(id, msg.sender, paid1, got0);
    }

    /// @notice Take a bid: pay the token0 leg, receive the escrowed token1.
    function takeBid(uint256 id) external returns (uint256 paid0, uint256 got1) {
        Position storage p = positions[id];
        require(p.live && !p.isAsk, "not takeable");
        paid0 = M.amount0Range(p.tickLower, p.tickUpper, tickSpacing, p.L, true);
        got1 = p.escrowed;
        p.live = false;
        require(token0.transferFrom(msg.sender, p.owner, paid0), "pay0");
        require(token1.transfer(msg.sender, got1), "send1");
        emit Taken(id, msg.sender, paid0, got1);
    }

    /// @notice Withdraw an unfilled position; refunds the escrowed leg.
    function cancel(uint256 id) external returns (uint256 refunded) {
        Position storage p = positions[id];
        require(p.live, "not live");
        require(p.owner == msg.sender, "not owner");
        p.live = false;
        refunded = p.escrowed;
        IERC20Minimal tok = p.isAsk ? token0 : token1;
        require(tok.transfer(msg.sender, refunded), "refund");
        emit Cancelled(id, refunded);
    }

    // ---- views: what L means in tokens, without picking a numeraire ----

    function quoteAsk(int24 lower, int24 upper, uint128 L) external view returns (uint256 amount0) {
        return M.amount0Range(lower, upper, tickSpacing, L, true);
    }

    function quoteBid(int24 lower, int24 upper, uint128 L) external view returns (uint256 amount1) {
        return M.amount1Range(lower, upper, tickSpacing, L, true);
    }
}
