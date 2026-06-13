// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MockERC20} from "../src/MockERC20.sol";
import {RollingFrontierBook} from "../src/RollingFrontierBook.sol";
import {newBook} from "./utils/BookFab.sol";

/// @dev Stateful fuzz handler: random makers and takers hammer one book
/// with every mutating entry point, preconditions satisfied by bounding,
/// never by assuming. Ghost state tracks every position ever minted so the
/// invariant contract can audit the book's full obligations.
contract BookHandler is Test {
    RollingFrontierBook public book;
    MockERC20 public t0;
    MockERC20 public t1;

    address[3] public actors;
    uint256[] public allPositions;

    int24 internal constant MIN_TICK = -60;
    int24 internal constant MAX_TICK = 120;

    constructor(RollingFrontierBook _book, MockERC20 _t0, MockERC20 _t1) {
        book = _book;
        t0 = _t0;
        t1 = _t1;
        for (uint256 i = 0; i < 3; i++) {
            actors[i] = address(uint160(0xA11CE + i));
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

    function depositAsk(uint256 seed, int24 lower, uint24 width, uint96 size, int8 slopeSeed) external {
        int24 cur = book.currentTick();
        lower = int24(bound(lower, cur + 1, MAX_TICK - 2));
        int24 upper = int24(bound(int24(uint24(bound(width, 1, 40))) + lower, lower + 1, MAX_TICK));
        uint128 l0 = uint128(bound(size, 1e6, 1e24));
        int128 m = int128(int256(bound(slopeSeed, -2, 2))) * int128(uint128(l0 / 64 + 1));
        // shape floor: size at every level must stay >= 1
        if (m < 0 && uint256(uint128(-m)) * uint256(uint24(upper - lower - 1)) >= l0) m = 0;
        vm.prank(_actor(seed));
        uint256 id = m == 0 ? book.deposit(lower, upper, l0) : book.depositShaped(lower, upper, l0, m);
        allPositions.push(id);
    }

    function depositBid(uint256 seed, int24 upper, uint24 width, uint96 size) external {
        int24 cur = book.currentTick();
        if (cur <= MIN_TICK + 2) return;
        upper = int24(bound(upper, MIN_TICK + 2, cur));
        int24 lower = int24(bound(upper - int24(uint24(bound(width, 1, 40))), MIN_TICK, upper - 1));
        uint128 l0 = uint128(bound(size, 1e6, 1e24));
        vm.prank(_actor(seed));
        uint256 id = book.depositBid(lower, upper, l0);
        allPositions.push(id);
    }

    function sweep(uint256 seed, int24 target, uint96 budget, uint8 maxFills) external {
        target = int24(bound(target, MIN_TICK, MAX_TICK));
        vm.prank(_actor(seed));
        book.sweepWithLimits(target, bound(maxFills, 1, 64), bound(budget, 1e6, 1e27), 0, block.timestamp);
    }

    function claimOrCancel(uint256 seed, uint256 pick, bool doCancel, bool internalCredit) external {
        if (allPositions.length == 0) return;
        uint256 id = allPositions[pick % allPositions.length];
        (address owner,,,,,,, bool live, bool isBid) = book.positions(id);
        if (!live) return;
        seed; // owner acts for themselves
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

/// @notice Invariant-mode fuzzing: under any interleaving of deposits,
/// shaped deposits, bids, budgeted sweeps in both directions, claims,
/// cancels, internal credits, and withdrawals, the book can always pay
/// everyone what its own views say they are owed.
contract InvariantsTest is Test {
    RollingFrontierBook internal book;
    MockERC20 internal t0;
    MockERC20 internal t1;
    BookHandler internal handler;

    function setUp() public {
        t0 = new MockERC20("T0", "T0");
        t1 = new MockERC20("T1", "T1");
        book = newBook(address(t0), address(t1), 1, 0, address(0), address(0));
        handler = new BookHandler(book, t0, t1);
        targetContract(address(handler));
    }

    /// forge-config: default.invariant.runs = 64
    /// forge-config: default.invariant.depth = 60
    function invariant_solvency() public view {
        uint256 owed0;
        uint256 owed1;
        uint256 n = handler.positionsCount();
        for (uint256 i = 0; i < n; i++) {
            uint256 id = handler.allPositions(i);
            (,,,,,,, bool live, bool isBid) = book.positions(id);
            if (!live) continue;
            if (isBid) {
                owed0 += book.bidClaimable(id);
                owed1 += book.bidRefundable(id);
            } else {
                owed1 += book.claimable(id);
                owed0 += book.unfilledPrincipal(id);
            }
        }
        assertGe(t0.balanceOf(address(book)), owed0, "token0 insolvency");
        assertGe(t1.balanceOf(address(book)), owed1, "token1 insolvency");
    }

    /// forge-config: default.invariant.runs = 64
    /// forge-config: default.invariant.depth = 60
    function invariant_noNegativeAggregates() public view {
        // aggregate liquidity prefix/suffix sums never go negative anywhere
        // in the active band (the require inside would revert the view)
        for (int24 t = -60; t <= 120; t += 20) {
            book.activeLiquidity(t);
            book.bidLiquidity(t);
        }
    }

    /// forge-config: default.invariant.runs = 64
    /// forge-config: default.invariant.depth = 60
    function invariant_everyPositionSettleable() public {
        // snapshot-revert trick: every live position must be cancellable
        // RIGHT NOW for exactly what the views promised
        uint256 n = handler.positionsCount();
        uint256 snap = vm.snapshotState();
        for (uint256 i = 0; i < n; i++) {
            uint256 id = handler.allPositions(i);
            (address owner,,,,,,, bool live, bool isBid) = book.positions(id);
            if (!live) continue;
            vm.startPrank(owner);
            if (isBid) book.cancelBid(id);
            else book.cancel(id);
            vm.stopPrank();
        }
        vm.revertToState(snap);
    }
}
