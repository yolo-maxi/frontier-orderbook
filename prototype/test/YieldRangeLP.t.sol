// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MockERC20} from "../src/MockERC20.sol";
import {MockYieldVault} from "../src/MockYieldVault.sol";
import {UniformFrontierBook} from "../src/UniformFrontierBook.sol";
import {YieldRangeLP, YieldRangeLPFactory, IYieldVault} from "../src/periphery/YieldRangeLP.sol";
import {newBook} from "./utils/BookFab.sol";

/// @notice NOTES-yield.md Level 1: a personal MM vault whose IDLE inventory
/// earns lending yield, pulled back just-in-time on rebalance. In-kind exit
/// when the lending market is stuck.
contract YieldRangeLPTest is Test {
    MockERC20 internal t0;
    MockERC20 internal t1;
    MockYieldVault internal v0;
    MockYieldVault internal v1;
    UniformFrontierBook internal book;
    YieldRangeLP internal lp;

    address internal fran = makeAddr("fran");
    address internal lender = makeAddr("lender");
    address internal taker = makeAddr("taker");

    uint128 internal constant SIZE = 1e18;

    function setUp() public {
        t0 = new MockERC20("WETH", "WETH");
        t1 = new MockERC20("USDC", "USDC");
        v0 = new MockYieldVault(address(t0), "aWETH", "aWETH");
        v1 = new MockYieldVault(address(t1), "aUSDC", "aUSDC");
        book = newBook(address(t0), address(t1), 1, 0, address(0), address(0));

        YieldRangeLPFactory factory = new YieldRangeLPFactory();
        vm.prank(fran);
        lp = YieldRangeLP(factory.createVault(book, IYieldVault(address(v0)), IYieldVault(address(v1))));

        // fund the vault: 100 token0 + 100 token1, but quote only 5 levels
        t0.mint(address(lp), 100e18);
        t1.mint(address(lp), 100e18);

        // lender drips yield into the markets
        t0.mint(lender, 1e24);
        t1.mint(lender, 1e24);
        vm.startPrank(lender);
        t0.approve(address(v0), type(uint256).max);
        t1.approve(address(v1), type(uint256).max);
        vm.stopPrank();

        t0.mint(taker, 1e24);
        t1.mint(taker, 1e24);
        vm.startPrank(taker);
        t0.approve(address(book), type(uint256).max);
        t1.approve(address(book), type(uint256).max);
        vm.stopPrank();
    }

    function testIdleCapitalEarnsWhileQuoted() public {
        vm.prank(fran);
        lp.open(SIZE, 5, 1);

        // 5 levels posted per side; the rest is parked in the yield vaults
        assertGt(v0.balanceOf(address(lp)), 0, "idle token0 parked");
        assertGt(v1.balanceOf(address(lp)), 0, "idle token1 parked");
        assertEq(t0.balanceOf(address(lp)), 0, "no hot token0 sitting dead");

        (uint256 before0,) = lp.totalValue();

        // yield accrues while the vault is live on the book
        vm.prank(lender);
        v0.drip(10e18); // appreciates every share including the LP's

        (uint256 after0,) = lp.totalValue();
        assertGt(after0, before0, "idle inventory earned yield while quoted");

        // the book side still works: taker lifts the ask ladder
        vm.prank(taker);
        book.moveTickTo(10);

        // rebalance pulls parked capital back, reposts around the new mid,
        // parks the new idle remainder — all in one call
        vm.prank(fran);
        lp.rebalance();
        assertGt(lp.askId() + lp.bidId(), 0, "still quoting after rebalance");
        assertGt(v1.balanceOf(address(lp)), 0, "idle remainder re-parked");
    }

    function testCloseReturnsPrincipalPlusYield() public {
        vm.prank(fran);
        lp.open(SIZE, 5, 1);

        vm.prank(lender);
        v0.drip(50e18);
        vm.prank(lender);
        v1.drip(50e18);

        vm.prank(fran);
        lp.close();

        // fran got everything back, strictly more than deposited (yield),
        // with no fills having happened
        assertGt(t0.balanceOf(fran), 100e18, "token0 principal + yield");
        assertGt(t1.balanceOf(fran), 100e18, "token1 principal + yield");
        assertEq(v0.balanceOf(address(lp)), 0, "vault emptied");
    }

    function testInKindExitWhenVaultStuck() public {
        vm.prank(fran);
        lp.open(SIZE, 5, 1);

        uint256 parkedShares = v0.balanceOf(address(lp));
        assertGt(parkedShares, 0);

        // freeze the lending market: drain its liquid assets so redeem fails
        vm.mockCallRevert(
            address(v0), abi.encodeWithSelector(MockYieldVault.redeem.selector), bytes("market frozen")
        );

        vm.prank(fran);
        lp.close(); // must NOT revert

        // fran holds the yield shares directly — funds never trapped
        assertEq(v0.balanceOf(fran), parkedShares, "in-kind exit delivered the shares");
        assertGt(t1.balanceOf(fran), 0, "the healthy side unwound normally");
    }
}
