// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {MockERC20} from "../src/MockERC20.sol";
import {RollingFrontierBook} from "../src/RollingFrontierBook.sol";
import {FrontierBookFactory} from "../src/FrontierBookFactory.sol";
import {FrontierRouter} from "../src/periphery/FrontierRouter.sol";
import {FrontierLens} from "../src/periphery/FrontierLens.sol";

/// @notice Periphery: aggregator-shaped router (v2-style path swaps with
/// exact-in semantics + refunds) and the lens (depth + to-the-wei quotes).
contract PeripheryTest is Test {
    MockERC20 internal t0;
    MockERC20 internal t1;
    FrontierBookFactory internal factory;
    FrontierRouter internal router;
    FrontierLens internal lens;
    RollingFrontierBook internal book;

    address internal mm;
    address internal trader;

    uint128 internal constant L = 1e18;

    function setUp() public {
        mm = makeAddr("mm");
        trader = makeAddr("trader");
        t0 = new MockERC20("WETH", "WETH");
        t1 = new MockERC20("USDC", "USDC");
        factory = new FrontierBookFactory(address(0));
        router = new FrontierRouter(factory);
        lens = new FrontierLens();
        book = RollingFrontierBook(factory.createBook(address(t0), address(t1), 1, 100));

        t0.mint(mm, 1e30);
        t1.mint(mm, 1e30);
        vm.startPrank(mm);
        t0.approve(address(book), type(uint256).max);
        t1.approve(address(book), type(uint256).max);
        // a two-sided market: asks above 100, bids below
        book.deposit(101, 111, L);
        book.depositBid(90, 100, L);
        vm.stopPrank();

        t0.mint(trader, 1e30);
        t1.mint(trader, 1e30);
        vm.startPrank(trader);
        t0.approve(address(router), type(uint256).max);
        t1.approve(address(router), type(uint256).max);
        vm.stopPrank();
    }

    function rate(int24 t) internal pure returns (uint256) {
        return uint256(int256(1e18) + int256(t) * 1e15);
    }

    function testV2StyleBuyMatchesLensQuote() public {
        uint256 amountIn = 3 * uint256(L); // roughly buys ~2.7 levels
        (uint256 q0, uint256 q1,) = lens.quoteBuy(book, amountIn);

        address[] memory path = new address[](2);
        path[0] = address(t1); // token1 in
        path[1] = address(t0); // token0 out
        uint256 bal0 = t0.balanceOf(trader);
        uint256 bal1 = t1.balanceOf(trader);

        vm.prank(trader);
        uint256[] memory amounts =
            router.swapExactTokensForTokens(amountIn, q0, path, trader, block.timestamp);

        assertEq(amounts[1], q0, "execution == lens quote (token0 out)");
        assertEq(amounts[0], q1, "spent == lens quote (token1 in)");
        assertEq(t0.balanceOf(trader) - bal0, q0, "received real token0");
        assertEq(bal1 - t1.balanceOf(trader), q1, "only the spent amount left the wallet (refund works)");
    }

    function testV2StyleSellMatchesLensQuote() public {
        uint256 amountIn = 4 * uint256(L);
        (uint256 q1, uint256 q0,) = lens.quoteSell(book, amountIn, 100);

        address[] memory path = new address[](2);
        path[0] = address(t0);
        path[1] = address(t1);
        vm.prank(trader);
        uint256[] memory amounts =
            router.swapExactTokensForTokens(amountIn, q1, path, trader, block.timestamp);

        assertEq(amounts[0], q0, "token0 spent == quote");
        assertEq(amounts[1], q1, "token1 out == quote");
    }

    function testMinOutProtects() public {
        address[] memory path = new address[](2);
        path[0] = address(t1);
        path[1] = address(t0);
        vm.prank(trader);
        vm.expectRevert(bytes("insufficient output"));
        router.swapExactTokensForTokens(uint256(L), 100 * uint256(L), path, trader, block.timestamp);
    }

    function testLensDepthAndSummary() public {
        FrontierLens.BookSummary memory s = lens.summary(book, 50);
        assertEq(s.currentTick, 100);
        assertEq(s.bestAsk, 101, "best ask found");
        assertEq(s.bestBid, 99, "best bid found");

        FrontierLens.Level[] memory levels = lens.depth(book, 90, 111, 64);
        uint256 asks;
        uint256 bids;
        for (uint256 i = 0; i < levels.length; i++) {
            if (levels[i].askSize > 0) asks++;
            if (levels[i].bidSize > 0) bids++;
        }
        assertEq(asks, 10, "10 ask levels visible");
        assertEq(bids, 10, "10 bid levels visible");
    }
}
