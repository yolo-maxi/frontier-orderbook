// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {MockERC20} from "../src/MockERC20.sol";
import {RollingFrontierBook} from "../src/RollingFrontierBook.sol";

/// @notice Two-sided market (bids below / asks above one shared pointer) and
/// taker protections (maxPay / minOut / deadline on both sweep directions).
contract FrontierTwoSidedTest is Test {
    MockERC20 internal t0;
    MockERC20 internal t1;
    RollingFrontierBook internal book;

    address internal mm;
    address internal mm2;
    address internal buyer; // up-sweeps: pays token1
    address internal seller; // down-sweeps: pays token0

    uint128 internal constant L = 1e18;

    function setUp() public {
        mm = makeAddr("mm");
        mm2 = makeAddr("mm2");
        buyer = makeAddr("buyer");
        seller = makeAddr("seller");
        t0 = new MockERC20("T0", "T0");
        t1 = new MockERC20("T1", "T1");
        book = new RollingFrontierBook(address(t0), address(t1), 1, 100);

        address[2] memory makers = [mm, mm2];
        for (uint256 i = 0; i < 2; i++) {
            t0.mint(makers[i], 1e30);
            t1.mint(makers[i], 1e30);
            vm.startPrank(makers[i]);
            t0.approve(address(book), type(uint256).max);
            t1.approve(address(book), type(uint256).max);
            vm.stopPrank();
        }
        t1.mint(buyer, 1e30);
        vm.prank(buyer);
        t1.approve(address(book), type(uint256).max);
        t0.mint(seller, 1e30);
        vm.prank(seller);
        t0.approve(address(book), type(uint256).max);
    }

    function rate(int24 t) internal pure returns (uint256) {
        return uint256(int256(1e18) + int256(t) * 1e15);
    }

    function ceilSpan1(int24 a, int24 b, uint256 size) internal pure returns (uint256 v) {
        uint256 acc;
        for (int24 t = a; t < b; t++) {
            acc += size * rate(t);
        }
        return (acc + 1e18 - 1) / 1e18;
    }

    function floorSpan1(int24 a, int24 b, uint256 size) internal pure returns (uint256) {
        uint256 acc;
        for (int24 t = a; t < b; t++) {
            acc += size * rate(t);
        }
        return acc / 1e18;
    }

    // ------------------------------------------------------------------
    // Bid mechanics (the mirror)
    // ------------------------------------------------------------------

    function testBidDepositFillClaim() public {
        uint256 mm1Before = t1.balanceOf(mm);
        vm.prank(mm);
        uint256 id = book.depositBid(90, 95, L); // wants 5 x L token0, below price 100

        assertEq(mm1Before - t1.balanceOf(mm), ceilSpan1(90, 95, L), "token1 value pulled (ceil)");
        assertEq(book.bidLiquidity(94), L, "top bid level live");
        assertEq(book.bidLiquidity(90), L, "bottom bid level live");

        // seller hits the bids: delivers token0, receives the levels' token1
        uint256 s0 = t0.balanceOf(seller);
        uint256 s1 = t1.balanceOf(seller);
        vm.prank(seller);
        book.moveTickTo(90);
        assertEq(s0 - t0.balanceOf(seller), 5 * uint256(L), "seller delivered token0");
        uint256 expected1;
        for (int24 t = 90; t < 95; t++) {
            expected1 += (uint256(L) * rate(t)) / 1e18; // per-level floor
        }
        assertEq(t1.balanceOf(seller) - s1, expected1, "seller got the bid levels' token1");

        // maker claims the bought token0
        assertEq(book.bidClaimable(id), 5 * uint256(L), "all levels claimable");
        vm.prank(mm);
        uint256 got = book.claimBid(id);
        assertEq(got, 5 * uint256(L), "maker bought exactly the asked token0");
        assertEq(t0.balanceOf(mm), 1e30 + 5 * uint256(L), "real token0 received");
    }

    function testBidNoResurrectionAndFreshness() public {
        vm.prank(mm);
        uint256 id = book.depositBid(90, 95, L);
        vm.prank(seller);
        book.moveTickTo(93); // fills [94,95) and [93,94)
        assertEq(book.bidClaimable(id), 2 * uint256(L), "two levels filled");

        // price recovers upward: nothing resurrects, claims unchanged
        vm.prank(buyer);
        book.moveTickTo(100);
        assertEq(book.bidClaimable(id), 2 * uint256(L), "no resurrection on recovery");
        assertEq(book.bidLiquidity(94), 0, "consumed bid level stays gone");

        // a fresh bid joins the consumed levels; the second pass is theirs
        vm.prank(mm2);
        uint256 id2 = book.depositBid(93, 95, L);
        vm.prank(seller);
        book.moveTickTo(93);
        assertEq(book.bidClaimable(id2), 2 * uint256(L), "second fill belongs to the new bid");
        assertEq(book.bidClaimable(id), 2 * uint256(L), "old bid unchanged: epoch isolation");
    }

    function testBidCancelMidFillReturnsMix() public {
        vm.prank(mm);
        uint256 id = book.depositBid(90, 95, L);
        vm.prank(seller);
        book.moveTickTo(93);

        vm.prank(mm);
        (uint256 proceeds0, uint256 refund1) = book.cancelBid(id);
        assertEq(proceeds0, 2 * uint256(L), "filled levels' token0");
        assertEq(refund1, floorSpan1(90, 93, L), "unfilled levels' token1 (floor)");
        assertEq(book.bidLiquidity(92), 0, "tail removed");

        // later down-moves pay the cancelled maker nothing
        vm.prank(seller);
        book.moveTickTo(80);
        assertEq(book.bidClaimable(id), 0, "dead bid earns nothing");
    }

    function testBidRequoteFreshAndCheap() public {
        vm.prank(mm);
        uint256 id = book.depositBid(90, 95, L);

        vm.prank(mm);
        uint256 g = gasleft();
        book.requoteBid(id, 80, 85, L);
        console2.log("bid requote gas:", g - gasleft());

        // abandoned levels fill: moved bid earns nothing there
        vm.prank(seller);
        book.moveTickTo(88);
        assertEq(book.bidClaimable(id), 0, "no proceeds from abandoned levels");
        // new levels fill normally
        vm.prank(seller);
        book.moveTickTo(83);
        assertEq(book.bidClaimable(id), 2 * uint256(L), "new levels pay");
    }

    function testBidWitnessChecks() public {
        vm.prank(mm);
        uint256 id = book.depositBid(90, 95, L);
        vm.prank(seller);
        book.moveTickTo(93);

        vm.prank(mm);
        vm.expectRevert(bytes("not filled"));
        book.claimBidTo(id, 92); // below the true frontier

        vm.prank(mm);
        vm.expectRevert(bytes("frontier not maximal"));
        book.cancelBidWithWitness(id, 94); // understated frontier

        vm.prank(mm);
        vm.expectRevert(bytes("frontier not filled"));
        book.cancelBidWithWitness(id, 92); // overstated frontier

        vm.prank(mm);
        (uint256 p0,) = book.cancelBidWithWitness(id, 93); // exact
        assertEq(p0, 2 * uint256(L));
    }

    // ------------------------------------------------------------------
    // Two-sided market structure
    // ------------------------------------------------------------------

    function testTwoSidedMarketDirectionalFills() public {
        vm.prank(mm);
        uint256 bid = book.depositBid(95, 98, L); // bids 95-97
        vm.prank(mm);
        uint256 ask = book.deposit(103, 106, L); // asks 103-105

        // buy sweep fills only asks
        vm.prank(buyer);
        book.moveTickTo(106);
        assertEq(book.claimable(ask), floorSpan1(103, 106, L), "asks filled");
        assertEq(book.bidClaimable(bid), 0, "bids untouched by up-sweep");

        // sell sweep fills only bids
        vm.prank(seller);
        book.moveTickTo(95);
        assertEq(book.bidClaimable(bid), 3 * uint256(L), "bids filled");
        assertEq(book.claimable(ask), floorSpan1(103, 106, L), "asks unchanged by down-sweep");
    }

    function testNoCrossingDeposits() public {
        vm.prank(mm);
        vm.expectRevert(bytes("range not above price"));
        book.deposit(99, 102, L); // ask at/below price

        vm.prank(mm);
        vm.expectRevert(bytes("range not below price"));
        book.depositBid(99, 102, L); // bid above price

        // touching quotes on both sides of the pointer are fine
        vm.prank(mm);
        book.deposit(101, 102, L); // best ask
        vm.prank(mm);
        book.depositBid(99, 100, L); // best bid
    }

    function testPointerCannotCrossLiquidityForFree() public {
        vm.prank(mm);
        book.depositBid(90, 95, L);

        // an account with no token0 cannot push the price down through bids
        address pinner = makeAddr("pinner");
        vm.prank(pinner);
        vm.expectRevert();
        book.moveTickTo(80); // would have to sell into the bids

        // but moving inside the spread (above the bids) is free
        vm.prank(pinner);
        book.moveTickTo(95);
        assertEq(book.currentTick(), 95, "free move within the spread");
    }

    // ------------------------------------------------------------------
    // Taker protections
    // ------------------------------------------------------------------

    function testUpSweepMaxPayParks() public {
        vm.prank(mm);
        uint256 ask = book.deposit(101, 111, L); // 10 levels

        // budget for ~2 levels only
        uint256 budget = ceilSpan1(101, 103, L);
        vm.prank(buyer);
        (int24 reached, uint256 paid, uint256 received) =
            book.sweepWithLimits(111, type(uint256).max, budget, 0, block.timestamp);

        assertEq(reached, 103, "parked at first unaffordable level");
        assertLe(paid, budget, "never exceeds maxPay");
        assertEq(received, 2 * uint256(L), "got exactly the affordable levels");
        assertEq(book.claimable(ask), floorSpan1(101, 103, L), "maker paid for 2 levels");

        // resume with a fresh budget completes the rest
        vm.prank(buyer);
        (reached,,) = book.sweepWithLimits(111, type(uint256).max, type(uint256).max, 0, block.timestamp);
        assertEq(reached, 111, "resumed to target");
    }

    function testDownSweepMaxPayParks() public {
        vm.prank(mm);
        book.depositBid(90, 95, L);

        vm.prank(seller);
        (int24 reached, uint256 paid, uint256 received) =
            book.sweepWithLimits(90, type(uint256).max, 2 * uint256(L), 0, block.timestamp);

        assertEq(reached, 93, "parked above first unaffordable bid level");
        assertEq(paid, 2 * uint256(L), "sold exactly the budget");
        assertEq(received, (uint256(L) * rate(94)) / 1e18 + (uint256(L) * rate(93)) / 1e18, "two levels' token1");
    }

    function testMinOutReverts() public {
        vm.prank(mm);
        book.deposit(101, 103, L); // only 2 levels available

        vm.prank(buyer);
        vm.expectRevert(bytes("insufficient output"));
        book.sweepWithLimits(111, type(uint256).max, type(uint256).max, 3 * uint256(L), block.timestamp);
    }

    function testDeadlineReverts() public {
        vm.prank(buyer);
        vm.expectRevert(bytes("expired"));
        book.sweepWithLimits(111, type(uint256).max, type(uint256).max, 0, block.timestamp - 1);
    }

    // ------------------------------------------------------------------
    // Conservation across both sides
    // ------------------------------------------------------------------

    function testTwoSidedConservation() public {
        vm.prank(mm);
        uint256 bid = book.depositBid(95, 98, L);
        vm.prank(mm2);
        uint256 ask = book.deposit(103, 106, L);

        vm.prank(buyer);
        book.moveTickTo(106);
        vm.prank(seller);
        book.moveTickTo(95);

        vm.prank(mm);
        book.claimBid(bid);
        vm.prank(mm);
        (, uint256 refund1) = book.cancelBid(bid);
        assertEq(refund1, 0, "fully filled bid has no refund");
        vm.prank(mm2);
        book.cancel(ask);

        // both ledgers conserved and the book holds only rounding dust
        int256 askSum;
        int256 bidSum;
        for (int24 t = 80; t <= 120; t++) {
            askSum += book.frontierDelta(t);
            bidSum += book.bidDelta(t);
            assertEq(book.activeLiquidity(t), 0, "ask side empty");
            assertEq(book.bidLiquidity(t), 0, "bid side empty");
        }
        assertEq(askSum, 0, "ask deltas conserved");
        assertEq(bidSum, 0, "bid deltas conserved");
        assertEq(t0.balanceOf(address(book)), 0, "no stranded token0");
        assertLt(t1.balanceOf(address(book)), 10, "token1 dust only");
    }
}
