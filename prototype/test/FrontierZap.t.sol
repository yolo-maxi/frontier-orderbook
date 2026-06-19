// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MockERC20} from "../src/MockERC20.sol";
import {RollingFrontierBook} from "../src/RollingFrontierBook.sol";
import {FrontierBookFactory} from "../src/FrontierBookFactory.sol";
import {FrontierLens} from "../src/periphery/FrontierLens.sol";
import {FrontierRouter} from "../src/periphery/FrontierRouter.sol";
import {newBook, newFactory} from "./utils/BookFab.sol";

contract FrontierZapTest is Test {
    MockERC20 internal t0;
    MockERC20 internal t1;
    RollingFrontierBook internal book;
    FrontierRouter internal router;

    address internal lp = makeAddr("copy-lp");
    address internal user = makeAddr("copy-user");
    address internal mm = makeAddr("maker");

    uint128 internal constant L = 1e18;

    function setUp() public {
        t0 = new MockERC20("YES", "YES");
        t1 = new MockERC20("sUSDC", "sUSDC");
        book = newBook(address(t0), address(t1), 1, 100, address(0), address(0));
        FrontierBookFactory factory = newFactory(address(0));
        router = new FrontierRouter(factory, new FrontierLens());

        t0.mint(lp, 1e30);
        t1.mint(lp, 1e30);
        vm.startPrank(lp);
        t0.approve(address(book), type(uint256).max);
        t1.approve(address(book), type(uint256).max);
        vm.stopPrank();

        t0.mint(user, 1e30);
        t1.mint(user, 1e30);
        vm.startPrank(user);
        t0.approve(address(router), type(uint256).max);
        t1.approve(address(router), type(uint256).max);
        vm.stopPrank();

        t0.mint(mm, 1e30);
        t1.mint(mm, 1e30);
        vm.startPrank(mm);
        t0.approve(address(book), type(uint256).max);
        t1.approve(address(book), type(uint256).max);
        vm.stopPrank();
    }

    function seedPool(uint256 amount0, uint256 amount1) internal {
        vm.prank(lp);
        book.depositShadow(amount0, amount1, 0);
    }

    function seedMarket() internal {
        vm.startPrank(mm);
        book.deposit(101, 151, L);
        book.depositBid(50, 100, L);
        vm.stopPrank();
    }

    function testBalancedZapMatchesRawShadowDeposit() public {
        seedPool(10 * uint256(L), 20 * uint256(L));

        FrontierRouter.ZapResult memory preview =
            router.previewZapDepositShadow(book, 5 * uint256(L), 10 * uint256(L));
        assertEq(preview.swapIn, 0, "balanced deposit does not swap");
        assertEq(preview.amount0Deposited, 5 * uint256(L), "preview token0 deposit");
        assertEq(preview.amount1Deposited, 10 * uint256(L), "preview token1 deposit");
        assertEq(preview.shares, 15 * uint256(L), "preview shares");

        vm.prank(user);
        FrontierRouter.ZapResult memory z = router.zapDepositShadow(
            book, 5 * uint256(L), 10 * uint256(L), 0, 15 * uint256(L), user, block.timestamp
        );

        assertEq(z.swapIn, 0, "no swap");
        assertEq(z.amount0Deposited, 5 * uint256(L), "token0 deposited");
        assertEq(z.amount1Deposited, 10 * uint256(L), "token1 deposited");
        assertEq(z.shares, 15 * uint256(L), "shares minted");
        assertEq(book.shadowSharesOf(user), 15 * uint256(L), "shares credited to user");
    }

    function testQuoteHeavyZapRebalancesAndDeposits() public {
        seedPool(100 * uint256(L), 100 * uint256(L));
        seedMarket();

        FrontierRouter.ZapResult memory preview = router.previewZapDepositShadow(book, 0, 20 * uint256(L));
        assertFalse(preview.swapped0For1, "quote swaps into outcome");
        assertGt(preview.swapIn, 0, "preview spends quote");
        assertGt(preview.swapOut, 0, "preview receives outcome");
        assertGt(preview.shares, 0, "preview mints shares");

        uint256 user0Before = t0.balanceOf(user);
        uint256 user1Before = t1.balanceOf(user);
        vm.prank(user);
        FrontierRouter.ZapResult memory z =
            router.zapDepositShadow(book, 0, 20 * uint256(L), preview.swapOut * 99 / 100, 1, user, block.timestamp);

        assertGt(z.swapIn, 0, "spent quote");
        assertGt(z.swapOut, 0, "bought outcome");
        assertGt(z.amount0Deposited, 0, "deposited outcome");
        assertGt(z.amount1Deposited, 0, "deposited quote");
        assertEq(book.shadowSharesOf(user), z.shares, "shares credited");
        assertEq(t0.balanceOf(address(router)), 0, "router holds no token0 dust");
        assertEq(t1.balanceOf(address(router)), 0, "router holds no token1 dust");
        assertEq(t0.balanceOf(user) - user0Before, z.refund0, "token0 refund accounting");
        assertEq(user1Before - t1.balanceOf(user), z.swapIn + z.amount1Deposited, "token1 accounting");
    }

    function testOutcomeHeavyZapRebalancesAndDeposits() public {
        seedPool(100 * uint256(L), 100 * uint256(L));
        seedMarket();

        FrontierRouter.ZapResult memory preview = router.previewZapDepositShadow(book, 20 * uint256(L), 0);
        assertTrue(preview.swapped0For1, "outcome swaps into quote");
        assertGt(preview.swapIn, 0, "preview spends outcome");
        assertGt(preview.swapOut, 0, "preview receives quote");
        assertGt(preview.shares, 0, "preview mints shares");

        vm.prank(user);
        FrontierRouter.ZapResult memory z =
            router.zapDepositShadow(book, 20 * uint256(L), 0, preview.swapOut * 99 / 100, 1, user, block.timestamp);

        assertGt(z.swapIn, 0, "sold outcome");
        assertGt(z.swapOut, 0, "received quote");
        assertGt(z.amount0Deposited, 0, "deposited outcome");
        assertGt(z.amount1Deposited, 0, "deposited quote");
        assertEq(book.shadowSharesOf(user), z.shares, "shares credited");
        assertEq(t0.balanceOf(address(router)), 0, "router holds no token0 dust");
        assertEq(t1.balanceOf(address(router)), 0, "router holds no token1 dust");
    }

    function testZapGuardsPreventBadExecution() public {
        seedPool(100 * uint256(L), 100 * uint256(L));
        seedMarket();

        FrontierRouter.ZapResult memory preview = router.previewZapDepositShadow(book, 0, 20 * uint256(L));
        vm.prank(user);
        vm.expectRevert(bytes("insufficient output"));
        router.zapDepositShadow(book, 0, 20 * uint256(L), preview.swapOut + 1, 0, user, block.timestamp);

        vm.prank(user);
        vm.expectRevert(bytes("insufficient shares"));
        router.zapDepositShadow(book, 5 * uint256(L), 5 * uint256(L), 0, type(uint256).max, user, block.timestamp);
    }

    function testEmptyPoolFirstZapSetsRatioWithoutSwap() public {
        FrontierRouter.ZapResult memory preview =
            router.previewZapDepositShadow(book, 2 * uint256(L), 7 * uint256(L));
        assertEq(preview.swapIn, 0, "first deposit does not auto-swap");
        assertEq(preview.shares, 9 * uint256(L), "first shares");
        assertEq(preview.amount0Deposited, 2 * uint256(L), "all token0 deposited");
        assertEq(preview.amount1Deposited, 7 * uint256(L), "all token1 deposited");

        vm.prank(user);
        FrontierRouter.ZapResult memory z =
            router.zapDepositShadow(book, 2 * uint256(L), 7 * uint256(L), 0, 9 * uint256(L), user, block.timestamp);

        (uint256 r0, uint256 r1, uint256 total) = book.shadowReserves();
        assertEq(z.swapIn, 0, "no swap");
        assertEq(r0, 2 * uint256(L), "reserve0");
        assertEq(r1, 7 * uint256(L), "reserve1");
        assertEq(total, 9 * uint256(L), "total shares");
        assertEq(book.shadowSharesOf(user), 9 * uint256(L), "recipient shares");
    }
}
