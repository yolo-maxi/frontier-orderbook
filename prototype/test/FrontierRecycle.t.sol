// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {MockERC20} from "../src/MockERC20.sol";
import {RollingFrontierBook} from "../src/RollingFrontierBook.sol";

/// @notice Internal-balance recycling: earned proceeds flow into new orders
/// without leaving the book — no claim transfer, no approve, no transferFrom.
contract FrontierRecycleTest is Test {
    MockERC20 internal t0;
    MockERC20 internal t1;
    RollingFrontierBook internal book;

    address internal mm;
    address internal buyer;
    address internal seller;

    uint128 internal constant L = 1e18;

    function setUp() public {
        mm = makeAddr("mm");
        buyer = makeAddr("buyer");
        seller = makeAddr("seller");
        t0 = new MockERC20("T0", "T0");
        t1 = new MockERC20("T1", "T1");
        book = new RollingFrontierBook(address(t0), address(t1), 1, 100);

        t0.mint(mm, 1e30);
        t1.mint(mm, 1e30);
        vm.startPrank(mm);
        t0.approve(address(book), type(uint256).max);
        t1.approve(address(book), type(uint256).max);
        vm.stopPrank();
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

    // ------------------------------------------------------------------
    // The core loop: filled bid's token0 -> new ask, zero transfers
    // ------------------------------------------------------------------

    function testRecycleBidIntoAskWithZeroApproval() public {
        // a maker who has NEVER approved token0 to the book — the strongest
        // proof that no transferFrom can be involved
        address fresh = makeAddr("fresh");
        t1.mint(fresh, 1e30);
        vm.prank(fresh);
        t1.approve(address(book), type(uint256).max); // token1 only, for the bid

        vm.prank(fresh);
        uint256 bid = book.depositBid(90, 95, L); // wants 5 L token0
        vm.prank(seller);
        book.moveTickTo(90); // bid fully filled: 5 L token0 earned

        uint256 wallet0 = t0.balanceOf(fresh);
        vm.prank(fresh);
        uint256 ask = book.recycleBidIntoAsk(bid, 101, 106, L, 0); // 5 levels of L

        assertEq(t0.balanceOf(fresh), wallet0, "token0 never touched the wallet");
        assertEq(book.internalBalance0(fresh), 0, "credit fully committed");
        assertEq(book.activeLiquidity(101), L, "new ask live");
        assertEq(book.activeLiquidity(105), L, "new ask live");

        // the recycled ask works like any other
        vm.prank(buyer);
        book.moveTickTo(102);
        assertEq(book.claimable(ask), (uint256(L) * rate(101)) / 1e18, "recycled ask fills and pays");
    }

    function testRecycleAskIntoBidMirror() public {
        address fresh = makeAddr("fresh2");
        t0.mint(fresh, 1e30);
        vm.prank(fresh);
        t0.approve(address(book), type(uint256).max); // token0 only, for the ask

        vm.prank(fresh);
        uint256 ask = book.deposit(101, 103, L);
        vm.prank(buyer);
        book.moveTickTo(103); // ask fully filled: token1 earned

        uint256 earned1 = (uint256(L) * rate(101)) / 1e18 + (uint256(L) * rate(102)) / 1e18;
        uint256 wallet1 = t1.balanceOf(fresh);
        // size the bid to cost less than the earnings; excess stays as credit
        vm.prank(fresh);
        book.recycleAskIntoBid(ask, 95, 97, L);

        assertEq(t1.balanceOf(fresh), wallet1, "token1 never touched the wallet");
        uint256 bidCost = (uint256(L) * rate(95) + uint256(L) * rate(96) + 1e18 - 1) / 1e18;
        assertEq(book.internalBalance1(fresh), earned1 - bidCost, "excess stays as credit");
        assertEq(book.bidLiquidity(96), L, "new bid live");
    }

    function testShortfallPullsOnlyTheDifference() public {
        vm.prank(mm);
        uint256 bid = book.depositBid(90, 95, L); // will earn 5 L token0
        vm.prank(seller);
        book.moveTickTo(90);

        uint256 wallet0 = t0.balanceOf(mm);
        vm.prank(mm);
        book.recycleBidIntoAsk(bid, 101, 109, L, 0); // needs 8 L, credit covers 5
        assertEq(wallet0 - t0.balanceOf(mm), 3 * uint256(L), "pulled exactly the shortfall");
        assertEq(book.internalBalance0(mm), 0, "credit exhausted first");
    }

    function testPlainDepositSpendsCreditFirst() public {
        vm.prank(mm);
        uint256 bid = book.depositBid(90, 95, L);
        vm.prank(seller);
        book.moveTickTo(90);
        vm.prank(mm);
        book.claimBidInternal(bid); // credit 5 L token0, no transfer

        uint256 wallet0 = t0.balanceOf(mm);
        vm.prank(mm);
        book.deposit(101, 104, L); // ordinary deposit, costs 3 L
        assertEq(t0.balanceOf(mm), wallet0, "funded entirely from credit");
        assertEq(book.internalBalance0(mm), 2 * uint256(L), "remainder still credited");
    }

    function testWithdrawInternal() public {
        vm.prank(mm);
        uint256 bid = book.depositBid(90, 95, L);
        vm.prank(seller);
        book.moveTickTo(90);
        vm.prank(mm);
        book.claimBidInternal(bid);

        uint256 wallet0 = t0.balanceOf(mm);
        vm.prank(mm);
        book.withdrawInternal(5 * uint256(L), 0);
        assertEq(t0.balanceOf(mm) - wallet0, 5 * uint256(L), "credit withdrawn");
        assertEq(book.internalBalance0(mm), 0, "ledger cleared");

        vm.prank(mm);
        vm.expectRevert(); // underflow: nothing left
        book.withdrawInternal(1, 0);
    }

    // ------------------------------------------------------------------
    // Solvency with credits outstanding
    // ------------------------------------------------------------------

    function testLedgerSolvency() public {
        vm.prank(mm);
        uint256 bid = book.depositBid(90, 95, L);
        vm.prank(seller);
        book.moveTickTo(90);
        vm.prank(mm);
        book.claimBidInternal(bid); // 5 L token0 credited, held by the book

        // the book must hold the credit on top of all order obligations
        assertGe(t0.balanceOf(address(book)), book.internalBalance0(mm), "credit fully backed");

        // full exit: cancel the (empty) bid remainder, withdraw the credit
        vm.prank(mm);
        book.cancelBid(bid);
        vm.prank(mm);
        book.withdrawInternal(5 * uint256(L), 0);
        assertEq(t0.balanceOf(address(book)), 0, "no stranded token0");
        assertLt(t1.balanceOf(address(book)), 10, "token1 dust only");
    }

    // ------------------------------------------------------------------
    // Gas: recycle vs the claim + deposit round trip
    // ------------------------------------------------------------------

    function testRecycleGasVsRoundTrip() public {
        // identical setups, two paths
        vm.startPrank(mm);
        uint256 bidA = book.depositBid(90, 95, L);
        uint256 bidB = book.depositBid(80, 85, L);
        vm.stopPrank();
        vm.prank(seller);
        book.moveTickTo(80); // both bids fully filled

        // path 1: claim out + deposit back in (wallet round trip, pre-approved)
        vm.startPrank(mm);
        uint256 g = gasleft();
        book.claimBid(bidA);
        book.deposit(101, 106, L);
        uint256 roundTrip = g - gasleft();

        // path 2: recycle in one call
        g = gasleft();
        book.recycleBidIntoAsk(bidB, 110, 115, L, 0);
        uint256 recycled = g - gasleft();
        vm.stopPrank();

        console2.log("claimBid + deposit (round trip):", roundTrip);
        console2.log("recycleBidIntoAsk:", recycled);
        assertLt(recycled, roundTrip, "recycling must beat the round trip");
    }
}
