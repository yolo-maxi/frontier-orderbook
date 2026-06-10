// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {MockERC20} from "../src/MockERC20.sol";
import {MockYieldVault} from "../src/MockYieldVault.sol";
import {RollingFrontierBook} from "../src/RollingFrontierBook.sol";
import {FrontierBookFactory} from "../src/FrontierBookFactory.sol";
import {newFactory} from "./utils/BookFab.sol";

/// @notice NOTES-yield.md Level 0: "yield-bearing pairs are just pairs".
/// The book trades the VAULT SHARE token; share price appreciates while
/// orders rest, so unfilled principal earns yield with ZERO book changes —
/// conservation holds because shares (not rebasing balances) are the unit.
contract YieldTest is Test {
    MockERC20 internal weth;
    MockERC20 internal usdc;
    MockYieldVault internal vault; // waWETH-style wrapper
    RollingFrontierBook internal book;

    address internal mm;
    address internal taker;
    address internal yieldSource;

    uint128 internal constant L = 1e18;

    function setUp() public {
        mm = makeAddr("mm");
        taker = makeAddr("taker");
        yieldSource = makeAddr("yieldSource");
        weth = new MockERC20("WETH", "WETH");
        usdc = new MockERC20("USDC", "USDC");
        vault = new MockYieldVault(address(weth), "Wrapped Aave WETH", "waWETH");

        // book trades (waWETH, USDC)
        FrontierBookFactory factory = newFactory(address(0));
        book = RollingFrontierBook(factory.createBook(address(vault), address(usdc), 1, 100));

        // maker wraps WETH into shares 1:1 at start
        weth.mint(mm, 100 * uint256(L));
        vm.startPrank(mm);
        weth.approve(address(vault), type(uint256).max);
        vault.deposit(100 * uint256(L), mm);
        vault.approve(address(book), type(uint256).max);
        vm.stopPrank();

        usdc.mint(taker, 1e30);
        vm.prank(taker);
        usdc.approve(address(book), type(uint256).max);

        weth.mint(yieldSource, 1e30);
        vm.prank(yieldSource);
        weth.approve(address(vault), type(uint256).max);
    }

    function testRestingOrdersEarnYield() public {
        // maker quotes 10 share-denominated ask levels
        vm.prank(mm);
        uint256 id = book.deposit(101, 111, L);

        // time passes: the vault earns 10% while the order rests
        vm.prank(yieldSource);
        vault.drip(10 * uint256(L));

        // market takes 4 levels; maker cancels the rest
        vm.prank(taker);
        book.moveTickTo(105);
        vm.prank(mm);
        (uint256 proceeds1, uint256 principal0) = book.cancel(id);

        assertEq(principal0, 6 * uint256(L), "6 unfilled SHARE units returned");
        assertGt(proceeds1, 0, "USDC proceeds for the filled levels");

        // the returned shares are now worth 10% more underlying:
        // the maker earned yield ON RESTING ORDER PRINCIPAL
        uint256 assetsNow = vault.convertToAssets(principal0);
        assertEq(assetsNow, 66 * uint256(L) / 10, "6 shares redeem 6.6 WETH after the 10% drip");

        vm.prank(mm);
        uint256 redeemed = vault.redeem(principal0, mm, mm);
        assertEq(weth.balanceOf(mm), redeemed, "real WETH out");
        assertGt(redeemed, principal0, "yield earned while quoted");
    }

    function testConservationHoldsWithAppreciatingShares() public {
        // shares never rebase, so the book's conservation is untouched by yield
        vm.prank(mm);
        uint256 id = book.deposit(101, 103, L);
        vm.prank(yieldSource);
        vault.drip(50 * uint256(L)); // wild appreciation mid-flight
        vm.prank(taker);
        book.moveTickTo(102);
        vm.prank(mm);
        (, uint256 principal0) = book.cancel(id);
        assertEq(principal0, uint256(L), "exact share-unit accounting unaffected by yield");
        assertEq(vault.balanceOf(address(book)), 0, "no shares stranded in the book");
    }
}
