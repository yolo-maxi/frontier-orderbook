// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.24;

import {UniformFrontierBook} from "../UniformFrontierBook.sol";
import {FrontierLens} from "./FrontierLens.sol";
import {GeoTickMath} from "../curve/GeoTickMath.sol";
import {IERC20Minimal} from "../RangeTakeProfitBook.sol";

interface IFrontierBookRegistry {
    function defaultBook(address token0, address token1) external view returns (address);
}

/// @title FrontierRouter — taker periphery with aggregator-friendly entry
/// points. Exposes Uniswap-v2-shaped `swapExactTokensForTokens` /
/// `getAmountsOut` (2-hop paths resolve to the pair's canonical book via the
/// factory) plus explicit per-book functions. Exact-input semantics map onto
/// the book's budgeted sweeps: spend up to amountIn, park exactly at the
/// affordable thin tick, refund the remainder.
contract FrontierRouter {
    IFrontierBookRegistry public immutable factory;
    FrontierLens public immutable lens;

    /// taker sweeps are bounded to this many ticks past the current pointer
    /// so exhausted books don't strand the pointer at grid extremes
    int24 public constant SWEEP_WINDOW = 200_000;
    uint256 internal constant SHADOW_FEE_BPS = 30;
    uint256 internal constant BPS = 10_000;
    uint256 internal constant ZAP_SEARCH_STEPS = 18;

    struct ZapResult {
        uint256 amount0In;
        uint256 amount1In;
        bool swapped0For1;
        uint256 swapIn;
        uint256 swapOut;
        uint256 amount0Deposited;
        uint256 amount1Deposited;
        uint256 shares;
        uint256 refund0;
        uint256 refund1;
    }

    event CopyLiquidityZap(
        address indexed book,
        address indexed user,
        address indexed recipient,
        bool swapped0For1,
        uint256 swapIn,
        uint256 swapOut,
        uint256 amount0Deposited,
        uint256 amount1Deposited,
        uint256 shares,
        uint256 refund0,
        uint256 refund1
    );

    constructor(address _factory, FrontierLens _lens) {
        factory = IFrontierBookRegistry(_factory);
        lens = _lens;
    }

    // ------------------------------------------------------------------
    // Aggregator-compatible (Uniswap v2 shaped)
    // ------------------------------------------------------------------

    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts) {
        require(path.length == 2, "2-hop paths only");
        UniformFrontierBook book = _bookFor(path[0], path[1]);
        bool buying = path[0] == address(book.token1()); // token1 in -> token0 out
        (uint256 paid, uint256 received) = buying
            ? _buy(book, amountIn, amountOutMin, to, deadline)
            : _sell(book, amountIn, amountOutMin, to, deadline);
        amounts = new uint256[](2);
        amounts[0] = paid;
        amounts[1] = received;
    }

    /// @notice v2-shaped read quote. One divergence from v2 semantics, by
    /// design: if the book can't absorb all of `amountIn`, `amounts[0]` is
    /// what would actually be spent (the rest is refunded on execution) —
    /// mirroring what `swapExactTokensForTokens` returns. Curve-aware via
    /// the lens (linear and geometric books both quote exactly).
    function getAmountsOut(uint256 amountIn, address[] calldata path) external view returns (uint256[] memory amounts) {
        require(path.length == 2, "2-hop paths only");
        UniformFrontierBook book = _bookFor(path[0], path[1]);
        bool buying = path[0] == address(book.token1());
        uint256 received;
        uint256 spent;
        if (buying) (received, spent,) = lens.quoteBuy(book, amountIn);
        else (received, spent,) = lens.quoteSell(book, amountIn, 4096);
        amounts = new uint256[](2);
        amounts[0] = spent;
        amounts[1] = received;
    }

    // ------------------------------------------------------------------
    // Explicit per-book entry points
    // ------------------------------------------------------------------

    /// @notice Spend up to `amount1In` token1 buying token0 from the asks.
    function buyExactIn(UniformFrontierBook book, uint256 amount1In, uint256 minOut0, address to, uint256 deadline)
        public
        returns (uint256 paid1, uint256 received0)
    {
        return _buy(book, amount1In, minOut0, to, deadline);
    }

    /// @notice Spend up to `amount0In` token0 selling into the bids.
    function sellExactIn(UniformFrontierBook book, uint256 amount0In, uint256 minOut1, address to, uint256 deadline)
        public
        returns (uint256 paid0, uint256 received1)
    {
        return _sell(book, amount0In, minOut1, to, deadline);
    }

    /// @notice Preview a copy-liquidity zap against current book and shadow
    /// reserves. Execution still needs minSwapOut/minSharesOut guards.
    function previewZapDepositShadow(UniformFrontierBook book, uint256 amount0In, uint256 amount1In)
        external
        view
        returns (ZapResult memory z)
    {
        (z,) = _prepareZap(book, amount0In, amount1In);
    }

    /// @notice Pull token0/token1, rebalance the heavy side through the book,
    /// deposit into copy liquidity for `to`, and refund unused dust.
    function zapDepositShadow(
        UniformFrontierBook book,
        uint256 amount0In,
        uint256 amount1In,
        uint256 minSwapOut,
        uint256 minSharesOut,
        address to,
        uint256 deadline
    ) external returns (ZapResult memory z) {
        require(block.timestamp <= deadline, "expired");
        require(to != address(0), "zero recipient");
        require(amount0In > 0 || amount1In > 0, "zero amounts");

        uint256 swapBudget;
        (z, swapBudget) = _prepareZap(book, amount0In, amount1In);

        IERC20Minimal t0 = book.token0();
        IERC20Minimal t1 = book.token1();
        if (amount0In > 0) require(t0.transferFrom(msg.sender, address(this), amount0In), "pull0 failed");
        if (amount1In > 0) require(t1.transferFrom(msg.sender, address(this), amount1In), "pull1 failed");

        uint256 held0 = amount0In;
        uint256 held1 = amount1In;
        if (swapBudget > 0) {
            uint256 paid;
            uint256 received;
            if (z.swapped0For1) {
                (paid, received) = _sellHeld(book, swapBudget, minSwapOut, deadline);
                held0 -= paid;
                held1 += received;
            } else {
                (paid, received) = _buyHeld(book, swapBudget, minSwapOut, deadline);
                held1 -= paid;
                held0 += received;
            }
            z.swapIn = paid;
            z.swapOut = received;
        } else {
            require(minSwapOut == 0, "insufficient output");
        }

        _ensureApproved(t0, address(book));
        _ensureApproved(t1, address(book));
        (z.shares, z.amount0Deposited, z.amount1Deposited) = book.depositShadowFor(to, held0, held1, minSharesOut);

        z.amount0In = amount0In;
        z.amount1In = amount1In;
        z.refund0 = held0 - z.amount0Deposited;
        z.refund1 = held1 - z.amount1Deposited;
        if (z.refund0 > 0) require(t0.transfer(msg.sender, z.refund0), "refund0 failed");
        if (z.refund1 > 0) require(t1.transfer(msg.sender, z.refund1), "refund1 failed");

        emit CopyLiquidityZap(
            address(book),
            msg.sender,
            to,
            z.swapped0For1,
            z.swapIn,
            z.swapOut,
            z.amount0Deposited,
            z.amount1Deposited,
            z.shares,
            z.refund0,
            z.refund1
        );
    }

    // ------------------------------------------------------------------

    function _buy(UniformFrontierBook book, uint256 amountIn, uint256 minOut, address to, uint256 deadline)
        internal
        returns (uint256 paid, uint256 received)
    {
        IERC20Minimal t1 = book.token1();
        require(t1.transferFrom(msg.sender, address(this), amountIn), "pull failed");
        (paid, received) = _buyHeld(book, amountIn, minOut, deadline);

        if (received > 0) require(book.token0().transfer(to, received), "payout failed");
        if (paid < amountIn) require(t1.transfer(msg.sender, amountIn - paid), "refund failed");
    }

    function _sell(UniformFrontierBook book, uint256 amountIn, uint256 minOut, address to, uint256 deadline)
        internal
        returns (uint256 paid, uint256 received)
    {
        IERC20Minimal t0 = book.token0();
        require(t0.transferFrom(msg.sender, address(this), amountIn), "pull failed");
        (paid, received) = _sellHeld(book, amountIn, minOut, deadline);

        if (received > 0) require(book.token1().transfer(to, received), "payout failed");
        if (paid < amountIn) require(t0.transfer(msg.sender, amountIn - paid), "refund failed");
    }

    function _buyHeld(UniformFrontierBook book, uint256 amountIn, uint256 minOut, uint256 deadline)
        internal
        returns (uint256 paid, uint256 received)
    {
        _ensureApproved(book.token1(), address(book));
        int24 target = _clampTick(book, int256(book.currentTick()) + SWEEP_WINDOW, book.tickSpacing());
        (, paid, received) = book.sweepWithLimits(target, type(uint256).max, amountIn, minOut, deadline);
    }

    function _sellHeld(UniformFrontierBook book, uint256 amountIn, uint256 minOut, uint256 deadline)
        internal
        returns (uint256 paid, uint256 received)
    {
        _ensureApproved(book.token0(), address(book));
        int24 target = _clampTick(book, int256(book.currentTick()) - SWEEP_WINDOW, book.tickSpacing());
        (, paid, received) = book.sweepWithLimits(target, type(uint256).max, amountIn, minOut, deadline);
    }

    function _prepareZap(UniformFrontierBook book, uint256 amount0In, uint256 amount1In)
        internal
        view
        returns (ZapResult memory z, uint256 swapBudget)
    {
        require(amount0In > 0 || amount1In > 0, "zero amounts");
        z.amount0In = amount0In;
        z.amount1In = amount1In;

        (uint256 r0, uint256 r1, uint256 total) = book.shadowReserves();
        if (total == 0 && (amount0In == 0 || amount1In == 0)) revert("imbalanced first deposit");

        uint256 held0 = amount0In;
        uint256 held1 = amount1In;
        uint256 depositR0 = r0;
        uint256 depositR1 = r1;

        if (total > 0 && r0 > 0 && r1 > 0) {
            uint256 lhs = amount0In * r1;
            uint256 rhs = amount1In * r0;
            if (lhs < rhs && amount1In > 0) {
                swapBudget = _chooseBuySwap(book, r0, r1, amount0In, amount1In);
                if (swapBudget > 0) {
                    (uint256 spent, uint256 out, uint256 nr0, uint256 nr1) = _quoteBuyShadowed(book, swapBudget, r0, r1);
                    if (spent > 0 && out > 0) {
                        z.swapped0For1 = false;
                        z.swapIn = spent;
                        z.swapOut = out;
                        held0 += out;
                        held1 -= spent;
                        depositR0 = nr0;
                        depositR1 = nr1;
                    } else {
                        swapBudget = 0;
                    }
                }
            } else if (lhs > rhs && amount0In > 0) {
                swapBudget = _chooseSellSwap(book, r0, r1, amount0In, amount1In);
                if (swapBudget > 0) {
                    (uint256 spent, uint256 out, uint256 nr0, uint256 nr1) =
                        _quoteSellShadowed(book, swapBudget, r0, r1);
                    if (spent > 0 && out > 0) {
                        z.swapped0For1 = true;
                        z.swapIn = spent;
                        z.swapOut = out;
                        held0 -= spent;
                        held1 += out;
                        depositR0 = nr0;
                        depositR1 = nr1;
                    } else {
                        swapBudget = 0;
                    }
                }
            }
        }

        (z.shares, z.amount0Deposited, z.amount1Deposited) = _previewDeposit(held0, held1, depositR0, depositR1, total);
        if (z.shares == 0) revert("insufficient shares");
        z.refund0 = held0 - z.amount0Deposited;
        z.refund1 = held1 - z.amount1Deposited;
    }

    function _chooseBuySwap(UniformFrontierBook book, uint256 r0, uint256 r1, uint256 amount0, uint256 amount1)
        internal
        view
        returns (uint256)
    {
        (uint256 spentFull, uint256 outFull,,) = _quoteBuyShadowed(book, amount1, r0, r1);
        if (spentFull == 0 || outFull == 0) return 0;
        if (!_buyCrosses(book, amount1, r0, r1, amount0, amount1)) return amount1;

        uint256 lo = 0;
        uint256 hi = amount1;
        for (uint256 i = 0; i < ZAP_SEARCH_STEPS && lo < hi; i++) {
            uint256 mid = (lo + hi) / 2;
            if (_buyCrosses(book, mid, r0, r1, amount0, amount1)) hi = mid;
            else lo = mid + 1;
        }
        return hi;
    }

    function _chooseSellSwap(UniformFrontierBook book, uint256 r0, uint256 r1, uint256 amount0, uint256 amount1)
        internal
        view
        returns (uint256)
    {
        (uint256 spentFull, uint256 outFull,,) = _quoteSellShadowed(book, amount0, r0, r1);
        if (spentFull == 0 || outFull == 0) return 0;
        if (!_sellCrosses(book, amount0, r0, r1, amount0, amount1)) return amount0;

        uint256 lo = 0;
        uint256 hi = amount0;
        for (uint256 i = 0; i < ZAP_SEARCH_STEPS && lo < hi; i++) {
            uint256 mid = (lo + hi) / 2;
            if (_sellCrosses(book, mid, r0, r1, amount0, amount1)) hi = mid;
            else lo = mid + 1;
        }
        return hi;
    }

    function _buyCrosses(
        UniformFrontierBook book,
        uint256 budget1,
        uint256 r0,
        uint256 r1,
        uint256 amount0,
        uint256 amount1
    ) internal view returns (bool) {
        (uint256 spent, uint256 out, uint256 nr0, uint256 nr1) = _quoteBuyShadowed(book, budget1, r0, r1);
        uint256 h0 = amount0 + out;
        uint256 h1 = amount1 - spent;
        return h0 * nr1 >= h1 * nr0;
    }

    function _sellCrosses(
        UniformFrontierBook book,
        uint256 budget0,
        uint256 r0,
        uint256 r1,
        uint256 amount0,
        uint256 amount1
    ) internal view returns (bool) {
        (uint256 spent, uint256 out, uint256 nr0, uint256 nr1) = _quoteSellShadowed(book, budget0, r0, r1);
        uint256 h0 = amount0 - spent;
        uint256 h1 = amount1 + out;
        return h0 * nr1 <= h1 * nr0;
    }

    function _quoteBuyShadowed(UniformFrontierBook book, uint256 budget1, uint256 r0, uint256 r1)
        internal
        view
        returns (uint256 spent1, uint256 out0, uint256 nr0, uint256 nr1)
    {
        nr0 = r0;
        nr1 = r1;
        if (budget1 == 0) return (0, 0, nr0, nr1);
        uint256 grossBudget = _maxGrossForTotal(budget1, book.takerFeeBps());
        uint256 realBudget = r0 == 0 ? grossBudget : grossBudget / 2;
        if (realBudget == 0) return (0, 0, nr0, nr1);

        (uint256 realSpent1, uint256 realOut0) = _quoteBuyGross(book, realBudget);
        if (realSpent1 == 0 || realOut0 == 0) return (0, 0, nr0, nr1);

        uint256 grossSpent = realSpent1;
        out0 = realOut0;
        if (r0 > 0) {
            uint256 shadowOut = r0 < realOut0 ? r0 : realOut0;
            if (shadowOut > 0) {
                uint256 shadowPaid = _mulDivUp(realSpent1, shadowOut, realOut0);
                uint256 shadowFee = _shadowFee(book, shadowPaid);
                grossSpent += shadowPaid;
                out0 += shadowOut;
                nr0 = r0 - shadowOut;
                nr1 = r1 + shadowPaid - shadowFee;
            }
        }

        spent1 = _takerTotal(grossSpent, book.takerFeeBps());
        if (spent1 > budget1) return (0, 0, r0, r1);
    }

    function _quoteSellShadowed(UniformFrontierBook book, uint256 budget0, uint256 r0, uint256 r1)
        internal
        view
        returns (uint256 spent0, uint256 out1, uint256 nr0, uint256 nr1)
    {
        nr0 = r0;
        nr1 = r1;
        if (budget0 == 0) return (0, 0, nr0, nr1);
        uint256 grossBudget = _maxGrossForTotal(budget0, book.takerFeeBps());
        uint256 realBudget = r1 == 0 ? grossBudget : grossBudget / 2;
        if (realBudget == 0) return (0, 0, nr0, nr1);

        (uint256 realSpent0, uint256 realOut1) = _quoteSellGross(book, realBudget);
        if (realSpent0 == 0 || realOut1 == 0) return (0, 0, nr0, nr1);

        uint256 grossSpent = realSpent0;
        out1 = realOut1;
        if (r1 > 0) {
            uint256 grossShadowOut = realOut1;
            uint256 shadowPaid = realSpent0;
            if (grossShadowOut > r1) {
                grossShadowOut = r1;
                shadowPaid = (realSpent0 * grossShadowOut) / realOut1;
                if (shadowPaid == 0) return (0, 0, r0, r1);
            }
            uint256 shadowFee = _shadowFee(book, grossShadowOut);
            grossSpent += shadowPaid;
            out1 += grossShadowOut - shadowFee;
            nr0 = r0 + shadowPaid;
            nr1 = r1 - grossShadowOut;
        }

        spent0 = _takerTotal(grossSpent, book.takerFeeBps());
        if (spent0 > budget0) return (0, 0, r0, r1);
    }

    function _quoteBuyGross(UniformFrontierBook book, uint256 grossBudget)
        internal
        view
        returns (uint256 spentGross, uint256 out0)
    {
        uint16 feeBps = book.takerFeeBps();
        uint256 totalBudget = _takerTotal(grossBudget, feeBps);
        uint256 spentTotal;
        (out0, spentTotal,) = lens.quoteBuy(book, totalBudget);
        spentGross = _maxGrossForTotal(spentTotal, feeBps);
    }

    function _quoteSellGross(UniformFrontierBook book, uint256 grossBudget)
        internal
        view
        returns (uint256 spentGross, uint256 out1)
    {
        uint16 feeBps = book.takerFeeBps();
        uint256 totalBudget = _takerTotal(grossBudget, feeBps);
        uint256 spentTotal;
        (out1, spentTotal,) = lens.quoteSell(book, totalBudget, 4096);
        spentGross = _maxGrossForTotal(spentTotal, feeBps);
    }

    function _previewDeposit(uint256 amount0Max, uint256 amount1Max, uint256 r0, uint256 r1, uint256 total)
        internal
        pure
        returns (uint256 shares, uint256 amount0, uint256 amount1)
    {
        if (total == 0) {
            amount0 = amount0Max;
            amount1 = amount1Max;
            shares = amount0 + amount1;
        } else if (r0 > 0 || r1 > 0) {
            uint256 s0 = r0 == 0 ? type(uint256).max : (amount0Max * total) / r0;
            uint256 s1 = r1 == 0 ? type(uint256).max : (amount1Max * total) / r1;
            shares = s0 < s1 ? s0 : s1;
            amount0 = r0 == 0 ? 0 : (shares * r0) / total;
            amount1 = r1 == 0 ? 0 : (shares * r1) / total;
        }
    }

    function _shadowFee(UniformFrontierBook book, uint256 grossToken1) internal view returns (uint256) {
        if (book.feeRecipient() == address(0)) return 0;
        return (grossToken1 * SHADOW_FEE_BPS) / BPS;
    }

    function _maxGrossForTotal(uint256 maxTotal, uint16 feeBps) internal pure returns (uint256) {
        if (feeBps == 0 || maxTotal == type(uint256).max) return maxTotal;
        uint256 denominator = BPS + uint256(feeBps);
        uint256 whole = maxTotal / denominator;
        uint256 remainder = maxTotal % denominator;
        return whole * BPS + (remainder * BPS) / denominator;
    }

    function _takerTotal(uint256 grossInput, uint16 feeBps) internal pure returns (uint256) {
        return feeBps == 0 ? grossInput : grossInput + (grossInput * feeBps) / BPS;
    }

    function _mulDivUp(uint256 x, uint256 y, uint256 d) internal pure returns (uint256) {
        return (x * y + d - 1) / d;
    }

    function _bookFor(address a, address b) internal view returns (UniformFrontierBook book) {
        address addr = factory.defaultBook(a, b);
        if (addr == address(0)) addr = factory.defaultBook(b, a);
        require(addr != address(0), "no book for pair");
        book = UniformFrontierBook(addr);
    }

    function _ensureApproved(IERC20Minimal token, address spender) internal {
        // MockERC20/standard tokens: set-and-forget max approval
        (bool ok, bytes memory ret) =
            address(token).call(abi.encodeWithSignature("allowance(address,address)", address(this), spender));
        uint256 current = ok && ret.length >= 32 ? abi.decode(ret, (uint256)) : 0;
        if (current < type(uint128).max) {
            (bool ok2,) =
                address(token).call(abi.encodeWithSignature("approve(address,uint256)", spender, type(uint256).max));
            require(ok2, "approve failed");
        }
    }

    /// @dev curve-aware sweep window: geometric books live on ±200k ticks
    /// (GeoTickMath domain), the linear demo curve on [-800, 8.388M).
    function _clampTick(UniformFrontierBook book, int256 t, int24 s) internal view returns (int24) {
        FrontierLens.Curve memory c = lens.curveOf(book);
        int256 max;
        int256 min;
        if (c.geo) {
            int256 q = int256(GeoTickMath.MAX_TICK) / int256(s);
            max = q * int256(s);
            min = -max;
        } else {
            int256 q = int256(8388000) / int256(s);
            max = q * int256(s);
            min = -800; // linear demo curve floor (rate > 0)
        }
        if (t > max) t = max;
        if (t < min) t = min;
        // forge-lint: disable-next-line(unsafe-typecast)
        return int24(t);
    }
}
