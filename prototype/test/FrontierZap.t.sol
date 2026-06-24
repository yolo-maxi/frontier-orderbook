// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MockERC20} from "../src/MockERC20.sol";
import {UniformFrontierBook} from "../src/UniformFrontierBook.sol";
import {FrontierGeoBookFactory} from "../src/FrontierGeoBookFactory.sol";
import {FrontierLens} from "../src/periphery/FrontierLens.sol";
import {FrontierRouter} from "../src/periphery/FrontierRouter.sol";
import {newBookWithFees, newFactory} from "./utils/BookFab.sol";

abstract contract FrontierZapBaseTest is Test {
    MockERC20 internal t0;
    MockERC20 internal t1;
    UniformFrontierBook internal book;
    FrontierGeoBookFactory internal factory;
    FrontierRouter internal router;
    address internal feeRecipient = makeAddr("feeRecipient");

    address internal lp = makeAddr("copy-lp");
    address internal lp2 = makeAddr("copy-lp-2");
    address internal user = makeAddr("copy-user");
    address internal user2 = makeAddr("copy-user-2");
    address internal maker = makeAddr("maker");
    address internal taker = makeAddr("taker");

    uint128 internal constant L = 1e18;
    uint16 internal constant TAKER_FEE_BPS = 30;

    function setUp() public {
        t0 = new MockERC20("YES", "YES");
        t1 = new MockERC20("sUSDC", "sUSDC");
        factory = newFactory(address(0));
        router = new FrontierRouter(address(factory), new FrontierLens());
        book = _deployBook(0);

        address[6] memory users = [lp, lp2, user, user2, maker, taker];
        for (uint256 i = 0; i < users.length; i++) {
            t0.mint(users[i], 1e30);
            t1.mint(users[i], 1e30);
            vm.startPrank(users[i]);
            t0.approve(address(book), type(uint256).max);
            t1.approve(address(book), type(uint256).max);
            t0.approve(address(router), type(uint256).max);
            t1.approve(address(router), type(uint256).max);
            vm.stopPrank();
        }
    }

    function _deployBook(uint16 takerFeeBps) internal virtual returns (UniformFrontierBook);

    function _approveBookForActors(UniformFrontierBook target) internal {
        address[6] memory users = [lp, lp2, user, user2, maker, taker];
        for (uint256 i = 0; i < users.length; i++) {
            vm.startPrank(users[i]);
            t0.approve(address(target), type(uint256).max);
            t1.approve(address(target), type(uint256).max);
            vm.stopPrank();
        }
    }

    function _useTakerFeeBook() internal {
        book = _deployBook(TAKER_FEE_BPS);
        _approveBookForActors(book);
    }

    function _seedPool(uint256 amount0, uint256 amount1) internal {
        vm.prank(lp);
        book.depositShadow(amount0, amount1, 0);
    }

    function _seedMarket() internal {
        vm.startPrank(maker);
        book.deposit(101, 151, L);
        book.depositBid(50, 100, L);
        vm.stopPrank();
    }

    function _assertZapEq(FrontierRouter.ZapResult memory a, FrontierRouter.ZapResult memory b) internal pure {
        assertEq(a.amount0In, b.amount0In, "amount0In");
        assertEq(a.amount1In, b.amount1In, "amount1In");
        assertEq(a.swapped0For1, b.swapped0For1, "direction");
        assertEq(a.swapIn, b.swapIn, "swapIn");
        assertEq(a.swapOut, b.swapOut, "swapOut");
        assertEq(a.amount0Deposited, b.amount0Deposited, "amount0Deposited");
        assertEq(a.amount1Deposited, b.amount1Deposited, "amount1Deposited");
        assertEq(a.shares, b.shares, "shares");
        assertEq(a.refund0, b.refund0, "refund0");
        assertEq(a.refund1, b.refund1, "refund1");
    }

    function _assertReserveSolvent() internal view {
        (uint256 r0, uint256 r1,) = book.shadowReserves();
        assertGe(t0.balanceOf(address(book)), r0, "reserve0 solvent");
        assertGe(t1.balanceOf(address(book)), r1, "reserve1 solvent");
    }

    function _trackedBalance(MockERC20 token, address actor) internal view returns (uint256) {
        return token.balanceOf(actor) + token.balanceOf(address(router)) + token.balanceOf(address(book))
            + token.balanceOf(feeRecipient);
    }

    function _assertRouterEmpty() internal view {
        assertEq(t0.balanceOf(address(router)), 0, "router token0 dust");
        assertEq(t1.balanceOf(address(router)), 0, "router token1 dust");
    }

    function _assertFeeZapExact(uint256 amount0, uint256 amount1, address actor) internal {
        FrontierRouter.ZapResult memory preview = router.previewZapDepositShadow(book, amount0, amount1);
        assertGt(preview.swapIn, 0, "fee test exercises swap input");
        assertGt(preview.swapOut, 0, "fee test exercises swap output");
        assertGt(preview.shares, 0, "fee test mints shares");

        uint256 tracked0Before = _trackedBalance(t0, actor);
        uint256 tracked1Before = _trackedBalance(t1, actor);
        uint256 feesBefore = t0.balanceOf(feeRecipient) + t1.balanceOf(feeRecipient);
        uint256 sharesBefore = book.shadowSharesOf(actor);

        vm.prank(actor);
        FrontierRouter.ZapResult memory z =
            router.zapDepositShadow(book, amount0, amount1, preview.swapOut, preview.shares, actor, block.timestamp);

        _assertZapEq(preview, z);
        assertEq(book.shadowSharesOf(actor) - sharesBefore, z.shares, "shares paid for");
        assertGt(z.amount0Deposited + z.amount1Deposited, 0, "nonzero deposit backs shares");

        uint256 held0 = amount0;
        uint256 held1 = amount1;
        if (z.swapIn > 0) {
            if (z.swapped0For1) {
                held0 -= z.swapIn;
                held1 += z.swapOut;
            } else {
                held1 -= z.swapIn;
                held0 += z.swapOut;
            }
        }
        assertEq(held0, z.amount0Deposited + z.refund0, "token0 deposited/refunded from held");
        assertEq(held1, z.amount1Deposited + z.refund1, "token1 deposited/refunded from held");

        assertEq(_trackedBalance(t0, actor), tracked0Before, "token0 conserved across actor/router/book/fees");
        assertEq(_trackedBalance(t1, actor), tracked1Before, "token1 conserved across actor/router/book/fees");
        assertGt(t0.balanceOf(feeRecipient) + t1.balanceOf(feeRecipient), feesBefore, "fee path charged");
        _assertRouterEmpty();
        _assertReserveSolvent();
    }

    function testDepositShadowForCreditsRecipientAndWithdraws() public {
        vm.prank(lp);
        (uint256 shares, uint256 used0, uint256 used1) = book.depositShadowFor(user, 10 ether, 20 ether, 0);

        assertEq(used0, 10 ether, "used token0");
        assertEq(used1, 20 ether, "used token1");
        assertEq(book.shadowSharesOf(user), shares, "recipient shares");
        assertEq(book.shadowSharesOf(lp), 0, "payer not credited");

        uint256 before0 = t0.balanceOf(user);
        uint256 before1 = t1.balanceOf(user);
        vm.prank(user);
        (uint256 out0, uint256 out1) = book.withdrawShadow(shares, 0, 0);
        assertEq(t0.balanceOf(user) - before0, out0, "withdraw token0");
        assertEq(t1.balanceOf(user) - before1, out1, "withdraw token1");
        (uint256 r0, uint256 r1, uint256 total) = book.shadowReserves();
        assertEq(r0, 0, "reserve0 empty");
        assertEq(r1, 0, "reserve1 empty");
        assertEq(total, 0, "shares empty");
    }

    function testBalancedZapMatchesPreviewAndRawDeposit() public {
        _seedPool(10 * uint256(L), 20 * uint256(L));

        FrontierRouter.ZapResult memory preview = router.previewZapDepositShadow(book, 5 * uint256(L), 10 * uint256(L));
        assertEq(preview.swapIn, 0, "balanced deposit does not swap");
        assertEq(preview.amount0Deposited, 5 * uint256(L), "preview token0 deposit");
        assertEq(preview.amount1Deposited, 10 * uint256(L), "preview token1 deposit");
        assertEq(preview.shares, 15 * uint256(L), "preview shares");

        vm.prank(user);
        FrontierRouter.ZapResult memory z =
            router.zapDepositShadow(book, 5 * uint256(L), 10 * uint256(L), 0, preview.shares, user, block.timestamp);

        _assertZapEq(preview, z);
        assertEq(book.shadowSharesOf(user), preview.shares, "shares credited to user");
        assertEq(t0.balanceOf(address(router)), 0, "router token0 dust");
        assertEq(t1.balanceOf(address(router)), 0, "router token1 dust");
    }

    function testQuoteHeavyZapRebalancesAndDeposits() public {
        _seedPool(100 * uint256(L), 100 * uint256(L));
        _seedMarket();

        FrontierRouter.ZapResult memory preview = router.previewZapDepositShadow(book, 0, 20 * uint256(L));
        assertFalse(preview.swapped0For1, "quote swaps into outcome");
        assertGt(preview.swapIn, 0, "preview spends quote");
        assertGt(preview.swapOut, 0, "preview receives outcome");
        assertGt(preview.shares, 0, "preview mints shares");

        uint256 user0Before = t0.balanceOf(user);
        uint256 user1Before = t1.balanceOf(user);
        vm.prank(user);
        FrontierRouter.ZapResult memory z =
            router.zapDepositShadow(book, 0, 20 * uint256(L), preview.swapOut, 1, user, block.timestamp);

        _assertZapEq(preview, z);
        assertEq(book.shadowSharesOf(user), z.shares, "shares credited");
        assertEq(t0.balanceOf(address(router)), 0, "router token0 dust");
        assertEq(t1.balanceOf(address(router)), 0, "router token1 dust");
        assertEq(t0.balanceOf(user) - user0Before, z.refund0, "token0 refund accounting");
        assertEq(user1Before - t1.balanceOf(user), z.swapIn + z.amount1Deposited, "token1 accounting");
        _assertReserveSolvent();
    }

    function testOutcomeHeavyZapRebalancesAndDeposits() public {
        _seedPool(100 * uint256(L), 100 * uint256(L));
        _seedMarket();

        FrontierRouter.ZapResult memory preview = router.previewZapDepositShadow(book, 20 * uint256(L), 0);
        assertTrue(preview.swapped0For1, "outcome swaps into quote");
        assertGt(preview.swapIn, 0, "preview spends outcome");
        assertGt(preview.swapOut, 0, "preview receives quote");
        assertGt(preview.shares, 0, "preview mints shares");

        vm.prank(user);
        FrontierRouter.ZapResult memory z =
            router.zapDepositShadow(book, 20 * uint256(L), 0, preview.swapOut, 1, user, block.timestamp);

        _assertZapEq(preview, z);
        assertEq(book.shadowSharesOf(user), z.shares, "shares credited");
        assertEq(t0.balanceOf(address(router)), 0, "router token0 dust");
        assertEq(t1.balanceOf(address(router)), 0, "router token1 dust");
        _assertReserveSolvent();
    }

    function testTakerFeeZapsMatchPreviewAndConserveBothDirections() public {
        _useTakerFeeBook();
        _seedPool(200 * uint256(L), 200 * uint256(L));
        _seedMarket();

        _assertFeeZapExact(0, 30 * uint256(L), user);
        _assertFeeZapExact(30 * uint256(L), 0, user2);
    }

    function testTakerFeeSmallSwapBudgetDoesNotUnderflow() public {
        _useTakerFeeBook();
        _seedPool(100 * uint256(L), 100 * uint256(L));
        _seedMarket();

        vm.expectRevert(bytes("insufficient shares"));
        router.previewZapDepositShadow(book, 0, 1);

        vm.expectRevert(bytes("insufficient shares"));
        router.previewZapDepositShadow(book, 1, 0);

        vm.prank(user);
        vm.expectRevert(bytes("insufficient shares"));
        router.zapDepositShadow(book, 0, 1, 0, 0, user, block.timestamp);

        vm.prank(user);
        vm.expectRevert(bytes("insufficient shares"));
        router.zapDepositShadow(book, 1, 0, 0, 0, user, block.timestamp);
    }

    function testZapGuardsPreventBadExecution() public {
        _seedPool(100 * uint256(L), 100 * uint256(L));
        _seedMarket();

        FrontierRouter.ZapResult memory preview = router.previewZapDepositShadow(book, 0, 20 * uint256(L));
        vm.prank(user);
        vm.expectRevert();
        router.zapDepositShadow(book, 0, 20 * uint256(L), preview.swapOut + 1, 0, user, block.timestamp);

        vm.prank(user);
        vm.expectRevert();
        router.zapDepositShadow(book, 5 * uint256(L), 5 * uint256(L), 0, type(uint256).max, user, block.timestamp);

        vm.expectRevert(bytes("zero amounts"));
        router.previewZapDepositShadow(book, 0, 0);
    }

    function testEmptyPoolFirstZapSetsRatioButRejectsOneSidedFirstDeposit() public {
        FrontierRouter.ZapResult memory preview = router.previewZapDepositShadow(book, 2 * uint256(L), 7 * uint256(L));
        assertEq(preview.swapIn, 0, "first deposit does not auto-swap");
        assertEq(preview.shares, 9 * uint256(L), "first shares");

        vm.prank(user);
        FrontierRouter.ZapResult memory z =
            router.zapDepositShadow(book, 2 * uint256(L), 7 * uint256(L), 0, preview.shares, user, block.timestamp);
        _assertZapEq(preview, z);

        (uint256 r0, uint256 r1, uint256 total) = book.shadowReserves();
        assertEq(r0, 2 * uint256(L), "reserve0");
        assertEq(r1, 7 * uint256(L), "reserve1");
        assertEq(total, 9 * uint256(L), "total shares");

        UniformFrontierBook fresh = _deployBook(0);
        vm.expectRevert(bytes("imbalanced first deposit"));
        router.previewZapDepositShadow(fresh, uint256(L), 0);
    }

    function testOneWeiAndSequentialDepositsWithdrawWithinRoundingTolerance() public {
        _seedPool(uint256(L), uint256(L));

        vm.prank(user);
        FrontierRouter.ZapResult memory a = router.zapDepositShadow(book, 1, 1, 0, 1, user, block.timestamp);
        assertEq(a.shares, 2, "one wei shares");

        vm.prank(user2);
        FrontierRouter.ZapResult memory b =
            router.zapDepositShadow(book, 3 * uint256(L), 3 * uint256(L), 0, 1, user2, block.timestamp);
        assertGt(b.shares, a.shares, "larger second deposit");

        uint256 userShares = book.shadowSharesOf(user);
        vm.prank(user);
        (uint256 out0, uint256 out1) = book.withdrawShadow(userShares, 0, 0);
        assertLe(out0, 2, "rounding bounded token0");
        assertLe(out1, 2, "rounding bounded token1");
        _assertReserveSolvent();
    }

    function testMaxUintPreviewGuardRevertsBeforeMintingFreeShares() public {
        _seedPool(uint256(L), uint256(L));
        vm.expectRevert();
        router.previewZapDepositShadow(book, type(uint256).max, type(uint256).max);
    }

    function testMultiActorCopyLiquiditySimulation() public {
        _seedPool(100 * uint256(L), 100 * uint256(L));
        _seedMarket();

        vm.prank(user);
        FrontierRouter.ZapResult memory a =
            router.zapDepositShadow(book, 0, 30 * uint256(L), 1, 1, user, block.timestamp);
        vm.prank(user2);
        FrontierRouter.ZapResult memory b =
            router.zapDepositShadow(book, 30 * uint256(L), 0, 1, 1, user2, block.timestamp);
        assertGt(a.shares + b.shares, 0, "LPs received shares");

        vm.prank(taker);
        book.sweepWithLimits(120, type(uint256).max, 15 * uint256(L), 0, block.timestamp);
        vm.prank(taker);
        book.sweepWithLimits(90, type(uint256).max, 15 * uint256(L), 0, block.timestamp);

        int24 cur = book.currentTick();
        vm.startPrank(maker);
        book.deposit(cur + 1, cur + 6, L / 2);
        book.depositBid(cur - 5, cur, L / 2);
        vm.stopPrank();

        vm.prank(taker);
        book.sweepWithLimits(cur + 6, type(uint256).max, 5 * uint256(L), 0, block.timestamp);
        vm.prank(taker);
        book.sweepWithLimits(cur - 5, type(uint256).max, 5 * uint256(L), 0, block.timestamp);
        _assertReserveSolvent();

        uint256 lpShares = book.shadowSharesOf(lp);
        uint256 userShares = book.shadowSharesOf(user);
        uint256 user2Shares = book.shadowSharesOf(user2);
        vm.prank(user);
        book.withdrawShadow(userShares, 0, 0);
        vm.prank(user2);
        book.withdrawShadow(user2Shares, 0, 0);
        vm.prank(lp);
        book.withdrawShadow(lpShares, 0, 0);

        (uint256 r0, uint256 r1, uint256 total) = book.shadowReserves();
        assertEq(r0, 0, "reserve0 fully withdrawn");
        assertEq(r1, 0, "reserve1 fully withdrawn");
        assertEq(total, 0, "shares fully burned");
    }

    function testFuzz_PreviewMatchesActual(uint96 raw0, uint96 raw1, uint8 skew) public {
        uint256 amount0 = bound(uint256(raw0), 1e12, 50 * uint256(L));
        uint256 amount1 = bound(uint256(raw1), 1e12, 50 * uint256(L));
        if (skew % 3 == 0) {
            amount0 = 0;
            amount1 = bound(uint256(raw1), 3 * uint256(L), 50 * uint256(L));
        }
        if (skew % 3 == 1) {
            amount0 = bound(uint256(raw0), 3 * uint256(L), 50 * uint256(L));
            amount1 = 0;
        }

        _seedPool(100 * uint256(L), 100 * uint256(L));
        _seedMarket();

        FrontierRouter.ZapResult memory preview = router.previewZapDepositShadow(book, amount0, amount1);
        vm.prank(user);
        FrontierRouter.ZapResult memory z =
            router.zapDepositShadow(book, amount0, amount1, preview.swapOut, preview.shares, user, block.timestamp);
        _assertZapEq(preview, z);
        assertEq(book.shadowSharesOf(user), z.shares, "shares credited");
        _assertReserveSolvent();
    }

    function testFuzz_TakerFeePreviewMatchesActual(uint96 raw, bool sellOutcome) public {
        _useTakerFeeBook();
        _seedPool(200 * uint256(L), 200 * uint256(L));
        _seedMarket();

        uint256 amount = bound(uint256(raw), 3 * uint256(L), 50 * uint256(L));
        uint256 amount0 = sellOutcome ? amount : 0;
        uint256 amount1 = sellOutcome ? 0 : amount;
        _assertFeeZapExact(amount0, amount1, user);
    }
}

contract FrontierZapTest is FrontierZapBaseTest {
    function _deployBook(uint16 takerFeeBps) internal override returns (UniformFrontierBook) {
        return newBookWithFees(
            address(t0), address(t1), 1, 100, address(0), address(0), feeRecipient, 0, takerFeeBps
        );
    }
}

contract FrontierZapGeometricTest is FrontierZapBaseTest {
    function _deployBook(uint16 takerFeeBps) internal override returns (UniformFrontierBook) {
        return UniformFrontierBook(
            factory.createGeoBookWithFees(
                address(t0), address(t1), 1, 100, feeRecipient, 0, takerFeeBps
            )
        );
    }
}

contract CopyLiquidityHandler is Test {
    MockERC20 public t0;
    MockERC20 public t1;
    UniformFrontierBook public book;
    FrontierRouter public router;
    address[4] public actors;

    uint128 internal constant L = 1e18;

    constructor(UniformFrontierBook _book, FrontierRouter _router, MockERC20 _t0, MockERC20 _t1) {
        book = _book;
        router = _router;
        t0 = _t0;
        t1 = _t1;
        actors = [address(0xA11CE), address(0xB0B), address(0xCAFE), address(0xD00D)];
        for (uint256 i = 0; i < actors.length; i++) {
            t0.mint(actors[i], 1e30);
            t1.mint(actors[i], 1e30);
            vm.startPrank(actors[i]);
            t0.approve(address(book), type(uint256).max);
            t1.approve(address(book), type(uint256).max);
            t0.approve(address(router), type(uint256).max);
            t1.approve(address(router), type(uint256).max);
            vm.stopPrank();
        }
    }

    function _actor(uint256 seed) internal view returns (address) {
        return actors[seed % actors.length];
    }

    function trackedShares() external view returns (uint256 total) {
        for (uint256 i = 0; i < actors.length; i++) {
            total += book.shadowSharesOf(actors[i]);
        }
    }

    function zap(uint256 seed, uint96 raw0, uint96 raw1) external {
        address actor = _actor(seed);
        uint256 amount0 = bound(uint256(raw0), 1e12, 20 * uint256(L));
        uint256 amount1 = bound(uint256(raw1), 1e12, 20 * uint256(L));
        if (seed % 3 == 0) amount0 = 0;
        if (seed % 3 == 1) amount1 = 0;
        try router.previewZapDepositShadow(book, amount0, amount1) returns (FrontierRouter.ZapResult memory p) {
            vm.prank(actor);
            try router.zapDepositShadow(book, amount0, amount1, p.swapOut, 1, actor, block.timestamp) {} catch {}
        } catch {}
    }

    function withdraw(uint256 seed, uint96 rawShares) external {
        address actor = _actor(seed);
        uint256 shares = book.shadowSharesOf(actor);
        if (shares == 0) return;
        uint256 burn = bound(uint256(rawShares), 1, shares);
        vm.prank(actor);
        book.withdrawShadow(burn, 0, 0);
    }

    function sweep(uint256 seed, int24 target, uint96 rawBudget) external {
        address actor = _actor(seed);
        target = int24(bound(target, 80, 120));
        uint256 budget = bound(uint256(rawBudget), 1e12, 20 * uint256(L));
        vm.prank(actor);
        try book.sweepWithLimits(target, type(uint256).max, budget, 0, block.timestamp) {} catch {}
    }

    function quote(uint256 seed, uint96 rawSize) external {
        address actor = _actor(seed);
        uint128 size = uint128(bound(uint256(rawSize), 1e12, uint256(L)));
        int24 cur = book.currentTick();
        vm.startPrank(actor);
        try book.deposit(cur + 1, cur + 4, size) {} catch {}
        try book.depositBid(cur - 3, cur, size) {} catch {}
        vm.stopPrank();
    }
}

contract CopyLiquidityInvariantTest is Test {
    MockERC20 internal t0;
    MockERC20 internal t1;
    UniformFrontierBook internal book;
    FrontierRouter internal router;
    CopyLiquidityHandler internal handler;
    address internal lp = makeAddr("seed-lp");
    address internal feeRecipient = makeAddr("feeRecipient");

    uint128 internal constant L = 1e18;

    function setUp() public {
        t0 = new MockERC20("YES", "YES");
        t1 = new MockERC20("sUSDC", "sUSDC");
        book = newBookWithFees(address(t0), address(t1), 1, 100, address(0), address(0), feeRecipient, 0, 0);
        FrontierGeoBookFactory factory = newFactory(address(0));
        router = new FrontierRouter(address(factory), new FrontierLens());

        t0.mint(lp, 1e30);
        t1.mint(lp, 1e30);
        vm.startPrank(lp);
        t0.approve(address(book), type(uint256).max);
        t1.approve(address(book), type(uint256).max);
        book.depositShadow(100 * uint256(L), 100 * uint256(L), 0);
        book.deposit(101, 130, L);
        book.depositBid(70, 100, L);
        vm.stopPrank();

        handler = new CopyLiquidityHandler(book, router, t0, t1);
        targetContract(address(handler));
    }

    /// forge-config: default.invariant.runs = 10000
    /// forge-config: default.invariant.depth = 1
    function invariant_shadowReservesAreSolvent() public view {
        (uint256 r0, uint256 r1, uint256 totalShares) = book.shadowReserves();
        assertGe(t0.balanceOf(address(book)), r0, "token0 reserve insolvent");
        assertGe(t1.balanceOf(address(book)), r1, "token1 reserve insolvent");
        assertEq(totalShares, book.shadowSharesOf(lp) + handler.trackedShares(), "share accounting");
    }

    /// forge-config: default.invariant.runs = 10000
    /// forge-config: default.invariant.depth = 1
    function invariant_shadowAggregatesDoNotUnderflow() public view {
        for (int24 t = 70; t <= 130; t += 10) {
            book.activeLiquidity(t);
            book.bidLiquidity(t);
        }
    }
}
