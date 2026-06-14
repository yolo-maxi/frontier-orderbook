// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, Vm} from "forge-std/Test.sol";
import {MockERC20} from "../src/MockERC20.sol";
import {GeometricFrontierBook} from "../src/GeometricFrontierBook.sol";
import {newGeoBook, newGeoBookWithFees} from "./utils/BookFab.sol";

/// @notice Asserts the indexer-facing event surface carries the fields an
/// off-chain indexer needs: the Deposit `isBid` side flag and the per-sweep
/// `Swept` summary (taker + ticks + exact amounts + taker fee). These are the
/// additive events introduced by the indexer-event audit; see
/// docs/indexer-event-gaps.md and indexer/.
contract IndexerEventsTest is Test {
    MockERC20 internal t0;
    MockERC20 internal t1;
    GeometricFrontierBook internal book;

    address internal maker = makeAddr("maker");
    address internal taker = makeAddr("taker");
    address internal feeRecipient = makeAddr("feeRecipient");

    uint128 internal constant L = 1e18;

    // mirrors of the events under test
    event Deposit(
        uint256 indexed positionId, address indexed owner, int24 lower, int24 upper, uint128 liquidity, bool isBid
    );
    event Swept(
        address indexed taker,
        int24 tickBefore,
        int24 tickAfter,
        uint256 amountIn,
        uint256 amountOut,
        uint256 takerFee
    );

    bytes32 internal constant DEPOSIT_SIG =
        keccak256("Deposit(uint256,address,int24,int24,uint128,bool)");
    bytes32 internal constant SWEPT_SIG = keccak256("Swept(address,int24,int24,uint256,uint256,uint256)");

    function setUp() public {
        t0 = new MockERC20("T0", "T0");
        t1 = new MockERC20("T1", "T1");
        book = newGeoBook(address(t0), address(t1), 1, 0, address(0), address(0));
        _fund(maker);
        _fund(taker);
    }

    function _fund(address who) internal {
        t0.mint(who, 1e30);
        t1.mint(who, 1e30);
        vm.startPrank(who);
        t0.approve(address(book), type(uint256).max);
        t1.approve(address(book), type(uint256).max);
        vm.stopPrank();
    }

    // ------------------------------------------------------------------
    // Deposit carries the ask/bid side
    // ------------------------------------------------------------------

    function test_deposit_emits_isBid_false_for_ask() public {
        uint256 id = book.nextPositionId();
        vm.expectEmit(true, true, false, true, address(book));
        emit Deposit(id, maker, 1, 11, L, false);
        vm.prank(maker);
        book.deposit(1, 11, L);
    }

    function test_depositBid_emits_isBid_true_for_bid() public {
        uint256 id = book.nextPositionId();
        vm.expectEmit(true, true, false, true, address(book));
        emit Deposit(id, maker, -10, 0, L, true);
        vm.prank(maker);
        book.depositBid(-10, 0, L);
    }

    // ------------------------------------------------------------------
    // Swept summarizes the taker trade
    // ------------------------------------------------------------------

    function test_swept_summary_matches_settlement_no_fee() public {
        vm.prank(maker);
        book.deposit(1, 11, L);

        vm.recordLogs();
        vm.prank(taker);
        (int24 reached, uint256 paid, uint256 received) =
            book.sweepWithLimits(8, type(uint256).max, type(uint256).max, 0, block.timestamp);

        (address t, int24 tb, int24 ta, uint256 aIn, uint256 aOut, uint256 fee) = _findSwept();
        assertEq(t, taker, "taker");
        assertEq(tb, int24(0), "tickBefore");
        assertEq(ta, reached, "tickAfter == reached");
        assertEq(aIn, paid, "amountIn == paid");
        assertEq(aOut, received, "amountOut == received");
        assertEq(fee, 0, "no taker fee");
        assertGt(aOut, 0, "filled something");
    }

    function test_swept_summary_includes_taker_fee() public {
        book = newGeoBookWithFees(address(t0), address(t1), 1, 0, address(0), address(0), feeRecipient, 0, 25);
        _fund(maker);
        _fund(taker);

        vm.prank(maker);
        book.deposit(1, 11, L);

        vm.recordLogs();
        vm.prank(taker);
        (int24 reached, uint256 paid, uint256 received) =
            book.sweepWithLimits(8, type(uint256).max, type(uint256).max, 0, block.timestamp);

        (address t, int24 tb, int24 ta, uint256 aIn, uint256 aOut, uint256 fee) = _findSwept();
        assertEq(t, taker, "taker");
        assertEq(tb, int24(0), "tickBefore");
        assertEq(ta, reached, "tickAfter");
        assertEq(aIn, paid, "amountIn == total paid (incl fee)");
        assertEq(aOut, received, "amountOut == received");
        assertGt(fee, 0, "taker fee charged");
        // amountIn is the TOTAL paid (fee included): fee == amountIn - gross,
        // where gross = amountIn * 10000 / (10000 + takerFeeBps), bps = 25.
        assertEq(fee, aIn - (aIn * 10000) / 10025, "fee == amountIn - gross input");
    }

    // decode the single Swept log out of the recorded set
    function _findSwept()
        internal
        returns (address taker_, int24 tickBefore, int24 tickAfter, uint256 amountIn, uint256 amountOut, uint256 fee)
    {
        Vm.Log[] memory entries = vm.getRecordedLogs();
        for (uint256 i = 0; i < entries.length; i++) {
            if (entries[i].emitter == address(book) && entries[i].topics[0] == SWEPT_SIG) {
                taker_ = address(uint160(uint256(entries[i].topics[1])));
                (tickBefore, tickAfter, amountIn, amountOut, fee) =
                    abi.decode(entries[i].data, (int24, int24, uint256, uint256, uint256));
                return (taker_, tickBefore, tickAfter, amountIn, amountOut, fee);
            }
        }
        revert("no Swept log");
    }
}
