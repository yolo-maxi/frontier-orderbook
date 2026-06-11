// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test, console2} from "forge-std/Test.sol";
import {MockERC20} from "../src/MockERC20.sol";
import {RollingFrontierBook} from "../src/RollingFrontierBook.sol";
import {FrontierBookFactory} from "../src/FrontierBookFactory.sol";
import {FrontierHookFlags} from "../src/hooks/IFrontierHooks.sol";
import {TwapOracleHook, SweepCircuitBreakerHook, MakerMilesHook} from "../src/hooks/examples/ExperimentHooks.sol";
import {newFactory} from "./utils/BookFab.sol";

/// @notice The experiment hooks: a TWAP oracle from afterSweep alone, a
/// per-block circuit breaker from beforeSweep's veto, and settlement-time
/// maker incentives from afterClaim/afterCancel.
contract HookExperimentsTest is Test {
    MockERC20 internal t0;
    MockERC20 internal t1;
    FrontierBookFactory internal factory;

    address internal mm;
    address internal taker;

    uint128 internal constant L = 1e18;

    function setUp() public {
        mm = makeAddr("mm");
        taker = makeAddr("taker");
        t0 = new MockERC20("T0", "T0");
        t1 = new MockERC20("T1", "T1");
        factory = newFactory(address(0));
    }

    function _hookedBook(address hookAddr) internal returns (RollingFrontierBook book) {
        book = RollingFrontierBook(factory.createBookWithHooks(address(t0), address(t1), 1, 0, hookAddr));
        t0.mint(mm, 1e30);
        vm.prank(mm);
        t0.approve(address(book), type(uint256).max);
        t1.mint(taker, 1e30);
        vm.prank(taker);
        t1.approve(address(book), type(uint256).max);
    }

    // ------------------------------------------------------------------
    // TWAP oracle: every price move flows through afterSweep
    // ------------------------------------------------------------------

    function _twapSetup() internal returns (TwapOracleHook hook, RollingFrontierBook book) {
        address addr = address((uint160(0x0A11CE) << 20) | FrontierHookFlags.AFTER_SWEEP_FLAG);
        deployCodeTo("ExperimentHooks.sol:TwapOracleHook", "", addr);
        hook = TwapOracleHook(addr);
        book = _hookedBook(addr);
        vm.prank(mm);
        book.deposit(1, 201, L); // one deep ask ladder to sweep through
    }

    function testTwapAveragesAcrossMoves() public {
        (TwapOracleHook hook, RollingFrontierBook book) = _twapSetup();

        // literal warp targets: under via-ir, `block.timestamp` (and locals
        // assigned from it) re-evaluate TIMESTAMP at each use site, so
        // relative warps compound across vm.warp calls. t starts at 1.
        vm.prank(taker);
        book.moveTickTo(10); // obs: tick 10 at t=1
        vm.warp(1001); // 1000s at tick 10
        vm.prank(taker);
        book.moveTickTo(20); // obs: tick 20 at t=1001
        vm.warp(2001); // 1000s at tick 20

        assertEq(hook.count(), 2, "two observations");
        assertEq(hook.consult(2000), 15, "1000s@10 + 1000s@20 averages to 15");
        assertEq(hook.consult(1000), 20, "trailing window all at tick 20");
        // straddling the second move: 500s@10 + 1000s@20 over 1500s = 16.66 -> 16
        assertEq(hook.consult(1500), 16, "interpolates inside intervals");
    }

    function testTwapSameSecondCollapses() public {
        (TwapOracleHook hook, RollingFrontierBook book) = _twapSetup();

        vm.startPrank(taker);
        book.moveTickTo(10);
        book.moveTickTo(30); // same second: overwrites, no second observation
        vm.stopPrank();
        assertEq(hook.count(), 1, "same-second moves collapse");

        vm.warp(block.timestamp + 50);
        assertEq(hook.consult(50), 30, "last move of the second wins");
    }

    function testTwapLookbackBounds() public {
        (TwapOracleHook hook, RollingFrontierBook book) = _twapSetup();

        vm.expectRevert(bytes("no observations"));
        hook.consult(1);

        vm.prank(taker);
        book.moveTickTo(10);
        vm.warp(block.timestamp + 10);
        vm.expectRevert(bytes("lookback beyond history"));
        hook.consult(11);
    }

    /// What attaching the oracle costs takers: identical ladders and sweeps
    /// on a hookless book vs a TWAP-hooked one. Run with --isolate for
    /// per-transaction numbers (the docs methodology).
    function testTwapHookSweepOverhead() public {
        (, RollingFrontierBook hooked) = _twapSetup();
        RollingFrontierBook plain = RollingFrontierBook(factory.createBook(address(t0), address(t1), 1, 0));
        vm.startPrank(mm);
        t0.approve(address(plain), type(uint256).max);
        plain.deposit(1, 201, L);
        vm.stopPrank();
        vm.prank(taker);
        t1.approve(address(plain), type(uint256).max);

        // first sweep: the oracle's count + ring slot are zero -> nonzero
        vm.prank(taker);
        uint256 g = gasleft();
        plain.moveTickTo(10);
        uint256 plainFirst = g - gasleft();
        vm.prank(taker);
        g = gasleft();
        hooked.moveTickTo(10);
        uint256 hookedFirst = g - gasleft();

        // steady state: each later observation is a fresh ring slot
        vm.warp(1001);
        vm.prank(taker);
        g = gasleft();
        plain.moveTickTo(20);
        uint256 plainNext = g - gasleft();
        vm.prank(taker);
        g = gasleft();
        hooked.moveTickTo(20);
        uint256 hookedNext = g - gasleft();

        console2.log("twap overhead, first sweep:", hookedFirst - plainFirst);
        console2.log("twap overhead, steady state:", hookedNext - plainNext);
        assertLt(hookedNext - plainNext, 60_000, "oracle should stay cheap");
    }

    // ------------------------------------------------------------------
    // Circuit breaker: beforeSweep is a real veto point
    // ------------------------------------------------------------------

    function _breakerSetup() internal returns (SweepCircuitBreakerHook hook, RollingFrontierBook book) {
        address addr = address((uint160(0x0B0B) << 20) | FrontierHookFlags.BEFORE_SWEEP_FLAG);
        deployCodeTo("ExperimentHooks.sol:SweepCircuitBreakerHook", abi.encode(int24(100)), addr);
        hook = SweepCircuitBreakerHook(addr);
        book = _hookedBook(addr);
        vm.prank(mm);
        book.deposit(1, 301, L);
    }

    function testBreakerCapsPerBlockMove() public {
        (, RollingFrontierBook book) = _breakerSetup();

        vm.prank(taker);
        book.moveTickTo(50); // |50 - 0| <= 100: fine

        vm.prank(taker);
        vm.expectRevert(bytes("hook rejected"));
        book.moveTickTo(160); // |160 - 0| > 100: blocked, ref is block-start tick

        vm.roll(block.number + 1); // new block: reference resets to current tick (50)
        vm.prank(taker);
        book.moveTickTo(140); // |140 - 50| <= 100: fine again
        vm.prank(taker);
        vm.expectRevert(bytes("hook rejected"));
        book.moveTickTo(260); // |260 - 50| > 100: blocked
    }

    // ------------------------------------------------------------------
    // Maker miles: credit exactly once, at settlement
    // ------------------------------------------------------------------

    function _milesSetup() internal returns (MakerMilesHook hook, RollingFrontierBook book) {
        address addr =
            address((uint160(0x0CAFE) << 20) | FrontierHookFlags.AFTER_CLAIM_FLAG | FrontierHookFlags.AFTER_CANCEL_FLAG);
        deployCodeTo("ExperimentHooks.sol:MakerMilesHook", "", addr);
        hook = MakerMilesHook(addr);
        book = _hookedBook(addr);
    }

    function testMilesCreditedOnClaim() public {
        (MakerMilesHook hook, RollingFrontierBook book) = _milesSetup();

        vm.prank(mm);
        uint256 id = book.deposit(1, 4, L);
        vm.prank(taker);
        book.moveTickTo(4); // fully filled

        vm.prank(mm);
        uint256 proceeds = book.claim(id);
        assertGt(proceeds, 0, "fills exist");
        assertEq(hook.miles(mm), proceeds, "miles == claimed proceeds");
        assertEq(hook.totalMiles(), proceeds, "global counter tracks");
    }

    function testMilesOnCancelCountFilledPartOnly() public {
        (MakerMilesHook hook, RollingFrontierBook book) = _milesSetup();

        vm.prank(mm);
        uint256 id = book.deposit(1, 11, L);
        vm.prank(taker);
        book.moveTickTo(5); // partial fill: levels 1-4

        vm.prank(mm);
        (uint256 proceeds, uint256 principal) = book.cancel(id);
        assertGt(proceeds, 0, "filled part");
        assertGt(principal, 0, "unfilled part refunded");
        assertEq(hook.miles(mm), proceeds, "only the filled part earns miles");
    }
}
