// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FrontierBookBase} from "./FrontierBookBase.sol";
import {FrontierHookFlags, IFrontierHooks} from "./hooks/IFrontierHooks.sol";

/// @title UniformMakerOps — cold maker-management companion
///
/// The cold maker-management companion for the uniform-curve book
/// (UniformFrontierBook and the deployed GeometricFrontierBook). The ASK-side
/// requote/cancel carry no slope: ladders are uniform, so there is no
/// requoteShaped surface and no _positionSlope / frontierSlope arithmetic.
/// Bids were always uniform (token0-denominated sizes).
///
/// Deployed with the same immutables as the book(s) it serves (delegatecalled
/// code reads its OWN immutables). Called directly it hits empty storage and
/// reverts on the `live` check — it holds no funds and has no deposit surface.
contract UniformMakerOps is FrontierBookBase {
    constructor(
        address _token0,
        address _token1,
        int24 _tickSpacing,
        address _hooks,
        address _permissions,
        address _feeRecipient,
        uint16 _makerFeeBps,
        uint16 _takerFeeBps
    )
        FrontierBookBase(
            _token0, _token1, _tickSpacing, 0, _hooks, _permissions, _feeRecipient, _makerFeeBps, _takerFeeBps
        )
    {}

    /// @notice Transfer position ownership (claims/refunds follow the new
    /// owner).
    function transferPosition(uint256 positionId, address to) external {
        Position storage p = _positions[positionId];
        require(p.live, "not live");
        _authOwner(p.owner);
        require(to != address(0), "zero owner");
        p.owner = to;
        emit PositionTransferred(positionId, msg.sender, to);
    }

    /// @notice Add funds to the pooled shadow inventory at the pool's
    /// current reserve ratio. The first depositor sets the ratio; later
    /// deposits are pro-rata and oracle-free.
    function depositShadow(uint256 amount0Max, uint256 amount1Max, uint256 minSharesOut)
        external
        returns (uint256 shares, uint256 amount0, uint256 amount1)
    {
        require(amount0Max > 0 || amount1Max > 0, "zero amounts");
        uint256 total = shadowTotalShares;
        if (total == 0) {
            require(amount0Max > 0 && amount1Max > 0, "imbalanced first deposit");
            amount0 = amount0Max;
            amount1 = amount1Max;
            shares = amount0 + amount1;
        } else {
            uint256 r0 = shadowReserve0;
            uint256 r1 = shadowReserve1;
            require(r0 > 0 || r1 > 0, "empty pool");
            uint256 s0 = r0 == 0 ? type(uint256).max : (amount0Max * total) / r0;
            uint256 s1 = r1 == 0 ? type(uint256).max : (amount1Max * total) / r1;
            shares = s0 < s1 ? s0 : s1;
            amount0 = r0 == 0 ? 0 : (shares * r0) / total;
            amount1 = r1 == 0 ? 0 : (shares * r1) / total;
        }
        require(shares >= minSharesOut && shares > 0, "insufficient shares");

        shadowTotalShares = total + shares;
        shadowShares[msg.sender] += shares;
        shadowReserve0 += amount0;
        shadowReserve1 += amount1;

        _transferInExact(token0, msg.sender, amount0, "non-exact token0 transfer");
        _transferInExact(token1, msg.sender, amount1, "non-exact token1 transfer");
        emit ShadowDeposit(msg.sender, amount0, amount1, shares);
    }

    /// @notice Burn shadow shares for a pro-rata slice of both reserves.
    function withdrawShadow(uint256 shares, uint256 minAmount0Out, uint256 minAmount1Out)
        external
        returns (uint256 amount0, uint256 amount1)
    {
        require(shares > 0, "zero shares");
        uint256 total = shadowTotalShares;
        require(total > 0 && shadowShares[msg.sender] >= shares, "insufficient shares");
        amount0 = (shares * shadowReserve0) / total;
        amount1 = (shares * shadowReserve1) / total;
        require(amount0 >= minAmount0Out && amount1 >= minAmount1Out, "insufficient amounts");

        shadowShares[msg.sender] -= shares;
        shadowTotalShares = total - shares;
        shadowReserve0 -= amount0;
        shadowReserve1 -= amount1;

        if (amount0 > 0) require(token0.transfer(msg.sender, amount0), "transfer0 failed");
        if (amount1 > 0) require(token1.transfer(msg.sender, amount1), "transfer1 failed");
        emit ShadowWithdraw(msg.sender, amount0, amount1, shares);
    }

    /// @notice O(1) re-price (and optionally re-size) of a completely UNFILLED
    /// uniform order; tokens settle difference-only, clock refreshes.
    function requote(uint256 positionId, int24 newLower, int24 newUpper, uint128 newLiquidity) external {
        Position storage p = _positions[positionId];
        require(p.live, "not live");
        require(!p.isBid, "use bid methods");
        _authOwner(p.owner);
        require(newLiquidity > 0, "zero liquidity");
        // completely unfilled <=> first interval not filled since deposit
        // (prefix-contiguity: nothing above it can have filled either)
        require(_highSince(p.depositClock) < p.lower + tickSpacing, "partially filled");
        _checkRange(newLower, newUpper);

        // remove old endpoint entries (order unfilled: frontier == lower),
        // place new ones
        _removeFlatOrderAt(p.lower, p.upper, p.liquidity);
        _addFlatOrder(newLower, newUpper, newLiquidity);

        uint256 oldAmount0 = uint256(p.liquidity) * uint256(_levels(p.lower, p.upper));
        uint256 newAmount0 = uint256(newLiquidity) * uint256(_levels(newLower, newUpper));

        p.lower = newLower;
        p.upper = newUpper;
        p.liquidity = newLiquidity;
        p.depositClock = fillClock;
        p.claimedUpper = newLower;

        if (newAmount0 > oldAmount0) {
            _pull0(msg.sender, newAmount0 - oldAmount0);
        } else if (oldAmount0 > newAmount0) {
            require(token0.transfer(msg.sender, oldAmount0 - newAmount0), "transfer out failed");
        }
        emit Requote(positionId, newLower, newUpper, newLiquidity);
    }

    /// @notice O(1) re-price of a completely unfilled bid; token1 settles
    /// difference-only.
    function requoteBid(uint256 positionId, int24 newLower, int24 newUpper, uint128 newLiquidity) external {
        Position storage p = _positions[positionId];
        require(p.live, "not live");
        require(p.isBid, "not a bid");
        _authOwner(p.owner);
        require(newLiquidity > 0, "zero liquidity");
        // completely unfilled <=> topmost level not filled since deposit
        require(_lowSince(p.depositClock) > p.upper - tickSpacing, "partially filled");
        require(newLower < newUpper, "empty range");
        require(newLower % tickSpacing == 0 && newUpper % tickSpacing == 0, "unaligned");
        require(newUpper <= _currentTick, "range not below price");

        _writeBidDelta(p.upper - tickSpacing, bidDelta[p.upper - tickSpacing] - int256(uint256(p.liquidity)));
        _writeBidDelta(p.lower - tickSpacing, bidDelta[p.lower - tickSpacing] + int256(uint256(p.liquidity)));
        _addBid(newLower, newUpper, newLiquidity);

        uint256 oldAmount1 = _uniformSpanValue(p.lower, p.upper, p.liquidity, true);
        uint256 newAmount1 = _uniformSpanValue(newLower, newUpper, newLiquidity, true);

        p.lower = newLower;
        p.upper = newUpper;
        p.liquidity = newLiquidity;
        p.depositClock = fillClock;
        p.claimedUpper = newUpper;

        if (newAmount1 > oldAmount1) {
            _pull1(msg.sender, newAmount1 - oldAmount1);
        } else if (oldAmount1 > newAmount1) {
            require(token1.transfer(msg.sender, oldAmount1 - newAmount1), "transfer out failed");
        }
        emit Requote(positionId, newLower, newUpper, newLiquidity);
    }

    /// @notice O(1) cancel against a maximal-frontier witness: pays unclaimed
    /// filled proceeds, returns the unfilled suffix principal, removes the
    /// order's endpoint deltas, retires the position.
    function cancelWithWitness(uint256 positionId, int24 frontier)
        public
        returns (uint256 proceeds1, uint256 principal0)
    {
        Position storage p = _positions[positionId];
        require(p.live, "not live");
        require(!p.isBid, "use bid methods");
        _authOwner(p.owner);
        require(frontier >= p.lower && frontier <= p.upper, "frontier out of range");
        require((frontier - p.lower) % tickSpacing == 0, "unaligned frontier");
        // proves frontier is filled-up-to...
        int24 hw = _highSince(p.depositClock);
        if (frontier > p.lower) require(hw >= frontier, "frontier not filled");
        // ...and maximal (next interval NOT filled since deposit)
        if (frontier < p.upper) {
            require(hw < frontier + tickSpacing, "frontier not maximal");
        }

        if (frontier > p.claimedUpper) {
            (proceeds1,) = _chargeMakerFee(token1, positionId, _askSpan(p, p.claimedUpper, frontier));
            p.claimedUpper = frontier;
        }
        if (frontier < p.upper) {
            _removeFlatOrderAt(frontier, p.upper, p.liquidity);
            principal0 = uint256(p.liquidity) * uint256(_levels(p.lower, p.upper) - _levelOf(p, frontier));
        }
        // if frontier == upper the order fully consumed: its +L already rolled
        // into upper and self-cancelled against its -L; nothing to remove.
        p.live = false;

        if (proceeds1 > 0) require(token1.transfer(p.owner, proceeds1), "transfer out failed");
        if (principal0 > 0) require(token0.transfer(p.owner, principal0), "transfer out failed");
        emit Cancel(positionId, proceeds1, principal0);
        _callHook(
            FrontierHookFlags.AFTER_CANCEL_FLAG,
            abi.encodeCall(IFrontierHooks.afterCancel, (msg.sender, positionId, proceeds1, principal0)),
            IFrontierHooks.afterCancel.selector
        );
    }

    /// @notice Convenience variant: finds the frontier itself in O(log width).
    function cancel(uint256 positionId) external returns (uint256 proceeds1, uint256 principal0) {
        Position storage p = _positions[positionId];
        require(p.live, "not live");
        require(!p.isBid, "use bid methods");
        _authOwner(p.owner);
        return cancelWithWitness(positionId, _frontier(p));
    }

    /// @notice O(1) bid cancel against a maximal-frontier witness.
    function cancelBidWithWitness(uint256 positionId, int24 frontier)
        public
        returns (uint256 proceeds0, uint256 refund1)
    {
        Position storage p = _positions[positionId];
        require(p.live, "not live");
        require(p.isBid, "not a bid");
        _authOwner(p.owner);
        require(frontier >= p.lower && frontier <= p.upper, "frontier out of range");
        require((frontier - p.lower) % tickSpacing == 0, "unaligned frontier");
        int24 lw = _lowSince(p.depositClock);
        if (frontier < p.upper) require(lw <= frontier, "frontier not filled");
        if (frontier > p.lower) {
            require(lw > frontier - tickSpacing, "frontier not maximal");
        }

        if (frontier < p.claimedUpper) {
            (proceeds0,) = _chargeMakerFee(
                token0,
                positionId,
                uint256(p.liquidity) * (uint256(uint24(p.claimedUpper - frontier)) / uint256(uint24(tickSpacing)))
            );
            p.claimedUpper = frontier;
        }
        if (frontier > p.lower) {
            _writeBidDelta(frontier - tickSpacing, bidDelta[frontier - tickSpacing] - int256(uint256(p.liquidity)));
            _writeBidDelta(p.lower - tickSpacing, bidDelta[p.lower - tickSpacing] + int256(uint256(p.liquidity)));
            refund1 = _uniformSpanValue(p.lower, frontier, p.liquidity, false);
        }
        p.live = false;

        if (proceeds0 > 0) require(token0.transfer(p.owner, proceeds0), "transfer out failed");
        if (refund1 > 0) require(token1.transfer(p.owner, refund1), "transfer out failed");
        emit Cancel(positionId, proceeds0, refund1);
        _callHook(
            FrontierHookFlags.AFTER_CANCEL_FLAG,
            abi.encodeCall(IFrontierHooks.afterCancel, (msg.sender, positionId, proceeds0, refund1)),
            IFrontierHooks.afterCancel.selector
        );
    }

    /// @notice Convenience variant: finds the bid frontier in O(log width).
    function cancelBid(uint256 positionId) external returns (uint256 proceeds0, uint256 refund1) {
        Position storage p = _positions[positionId];
        require(p.live, "not live");
        require(p.isBid, "not a bid");
        _authOwner(p.owner);
        return cancelBidWithWitness(positionId, _bidFrontier(p));
    }
}
