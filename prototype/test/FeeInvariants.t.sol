// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MockERC20} from "../src/MockERC20.sol";
import {UniformFrontierBook} from "../src/UniformFrontierBook.sol";
import {newBookWithFees} from "./utils/BookFab.sol";

contract FeeBookHandler is Test {
    UniformFrontierBook public book;
    MockERC20 public t0;
    MockERC20 public t1;
    address public feeRecipient;
    address[3] public actors;
    uint256[] public allPositions;

    int24 internal constant MIN_TICK = -60;
    int24 internal constant MAX_TICK = 120;

    constructor(UniformFrontierBook _book, MockERC20 _t0, MockERC20 _t1, address _feeRecipient) {
        book = _book;
        t0 = _t0;
        t1 = _t1;
        feeRecipient = _feeRecipient;
        for (uint256 i; i < 3; i++) {
            actors[i] = address(uint160(0xFEE000 + i));
            t0.mint(actors[i], 1e30);
            t1.mint(actors[i], 1e30);
            vm.startPrank(actors[i]);
            t0.approve(address(book), type(uint256).max);
            t1.approve(address(book), type(uint256).max);
            vm.stopPrank();
        }
    }

    function positionsCount() external view returns (uint256) {
        return allPositions.length;
    }

    function _actor(uint256 seed) internal view returns (address) {
        return actors[seed % 3];
    }

    modifier feesNeverDecrease() {
        uint256 before0 = t0.balanceOf(feeRecipient);
        uint256 before1 = t1.balanceOf(feeRecipient);
        _;
        assertGe(t0.balanceOf(feeRecipient), before0, "token0 fees decreased");
        assertGe(t1.balanceOf(feeRecipient), before1, "token1 fees decreased");
    }

    function depositAsk(uint256 seed, int24 lower, uint24 width, uint96 size) external feesNeverDecrease {
        int24 cur = book.currentTick();
        lower = int24(bound(lower, cur + 1, MAX_TICK - 2));
        int24 upper = int24(bound(int24(uint24(bound(width, 1, 40))) + lower, lower + 1, MAX_TICK));
        uint128 l0 = uint128(bound(size, 1e6, 1e24));
        vm.prank(_actor(seed));
        uint256 id = book.deposit(lower, upper, l0);
        allPositions.push(id);
    }

    function depositBid(uint256 seed, int24 upper, uint24 width, uint96 size) external feesNeverDecrease {
        int24 cur = book.currentTick();
        if (cur <= MIN_TICK + 2) return;
        upper = int24(bound(upper, MIN_TICK + 2, cur));
        int24 lower = int24(bound(upper - int24(uint24(bound(width, 1, 40))), MIN_TICK, upper - 1));
        uint128 l0 = uint128(bound(size, 1e6, 1e24));
        vm.prank(_actor(seed));
        uint256 id = book.depositBid(lower, upper, l0);
        allPositions.push(id);
    }

    function sweep(uint256 seed, int24 target, uint96 budget, uint8 maxFills) external feesNeverDecrease {
        target = int24(bound(target, MIN_TICK, MAX_TICK));
        vm.prank(_actor(seed));
        book.sweepWithLimits(target, bound(maxFills, 1, 64), bound(budget, 1e6, 1e27), 0, block.timestamp);
    }

    function claimOrCancel(uint256 seed, uint256 pick, bool doCancel, bool) external feesNeverDecrease {
        seed;
        if (allPositions.length == 0) return;
        uint256 id = allPositions[pick % allPositions.length];
        (address owner,,,,,, bool live, bool isBid) = book.positions(id);
        if (!live) return;
        vm.startPrank(owner);
        if (isBid) {
            if (doCancel) book.cancelBid(id);
            else book.claimBid(id);
        } else {
            if (doCancel) book.cancel(id);
            else book.claim(id);
        }
        vm.stopPrank();
    }
}

contract FeeInvariantsTest is Test {
    UniformFrontierBook internal book;
    MockERC20 internal t0;
    MockERC20 internal t1;
    FeeBookHandler internal handler;
    address internal feeRecipient = makeAddr("feeRecipient");

    function setUp() public {
        t0 = new MockERC20("T0", "T0");
        t1 = new MockERC20("T1", "T1");
        book = newBookWithFees(address(t0), address(t1), 1, 0, address(0), address(0), feeRecipient, 137, 59);
        handler = new FeeBookHandler(book, t0, t1, feeRecipient);
        targetContract(address(handler));
    }

    /// forge-config: default.invariant.runs = 96
    /// forge-config: default.invariant.depth = 80
    function invariant_feeBookSolvency() public view {
        uint256 owed0;
        uint256 owed1;
        uint256 n = handler.positionsCount();
        for (uint256 i; i < n; i++) {
            uint256 id = handler.allPositions(i);
            (,,,,,, bool live, bool isBid) = book.positions(id);
            if (!live) continue;
            if (isBid) {
                owed0 += book.bidClaimable(id);
                owed1 += book.bidRefundable(id);
            } else {
                owed1 += book.claimable(id);
                owed0 += book.unfilledPrincipal(id);
            }
        }
        assertGe(t0.balanceOf(address(book)), owed0, "fee token0 insolvency");
        assertGe(t1.balanceOf(address(book)), owed1, "fee token1 insolvency");
    }

    /// forge-config: default.invariant.runs = 96
    /// forge-config: default.invariant.depth = 80
    function invariant_feeBookNoNegativeAggregates() public view {
        for (int24 t = -60; t <= 120; t += 20) {
            book.activeLiquidity(t);
            book.bidLiquidity(t);
        }
    }

    /// forge-config: default.invariant.runs = 96
    /// forge-config: default.invariant.depth = 80
    function invariant_feeBookEveryPositionSettleable() public {
        uint256 n = handler.positionsCount();
        uint256 snap = vm.snapshotState();
        for (uint256 i; i < n; i++) {
            uint256 id = handler.allPositions(i);
            (address owner,,,,,, bool live, bool isBid) = book.positions(id);
            if (!live) continue;
            vm.startPrank(owner);
            if (isBid) book.cancelBid(id);
            else book.cancel(id);
            vm.stopPrank();
        }
        vm.revertToState(snap);
    }
}
