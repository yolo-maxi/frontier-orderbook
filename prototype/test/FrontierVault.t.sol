// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {FrontierVault} from "../src/FrontierVault.sol";
import {MockERC20} from "../src/MockERC20.sol";

contract FrontierVaultTest is Test {
    FrontierVault internal vault;
    MockERC20 internal token;

    address internal user = makeAddr("user");
    address internal book = makeAddr("book");

    function setUp() public {
        vault = new FrontierVault(address(this));
        token = new MockERC20("Token", "TKN");
        token.mint(user, 1e24);
        vm.prank(user);
        token.approve(address(vault), type(uint256).max);
    }

    function testDepositAndWithdraw() public {
        vm.prank(user);
        vault.deposit(address(token), 100 ether);

        assertEq(vault.balanceOf(user, address(token)), 100 ether);
        assertEq(vault.totalCredits(address(token)), 100 ether);
        assertEq(token.balanceOf(address(vault)), 100 ether);
        assertTrue(vault.solvent(address(token)));

        uint256 walletBefore = token.balanceOf(user);
        vm.prank(user);
        vault.withdraw(address(token), 40 ether);

        assertEq(vault.balanceOf(user, address(token)), 60 ether);
        assertEq(vault.totalCredits(address(token)), 60 ether);
        assertEq(token.balanceOf(user) - walletBefore, 40 ether);
        assertTrue(vault.solvent(address(token)));
    }

    function testOnlyAuthorizedBookCanDebitCreditOrPay() public {
        vm.prank(user);
        vault.deposit(address(token), 100 ether);

        vm.expectRevert(bytes("not book"));
        vault.debit(user, address(token), 1 ether);

        vm.expectRevert(bytes("not book"));
        vault.credit(user, address(token), 1 ether);

        vm.expectRevert(bytes("not book"));
        vault.pay(address(token), user, 1 ether);

        vault.setBookAuthorization(book, true);

        vm.prank(book);
        vault.debit(user, address(token), 10 ether);
        assertEq(vault.balanceOf(user, address(token)), 90 ether);
        assertEq(vault.totalCredits(address(token)), 90 ether);

        vm.prank(book);
        vault.credit(user, address(token), 5 ether);
        assertEq(vault.balanceOf(user, address(token)), 95 ether);
        assertEq(vault.totalCredits(address(token)), 95 ether);

        vm.prank(book);
        vault.pay(address(token), makeAddr("taker"), 5 ether);
        assertTrue(vault.solvent(address(token)));
    }

    function testOnlyOwnerCanAuthorizeBooks() public {
        vm.prank(user);
        vm.expectRevert(bytes("not owner"));
        vault.setBookAuthorization(book, true);

        vault.setBookAuthorization(book, true);
        assertTrue(vault.authorizedBook(book));
    }
}
