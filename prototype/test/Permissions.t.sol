// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {MockERC20} from "../src/MockERC20.sol";
import {RollingFrontierBook} from "../src/RollingFrontierBook.sol";
import {FrontierBookFactory} from "../src/FrontierBookFactory.sol";
import {PermissionRegistry} from "../src/permissions/PermissionRegistry.sol";
import {newFactory} from "./utils/BookFab.sol";

/// @notice Delegatable permissions (ERC Approval Registry) on the book:
/// owners grant selector-scoped rights to operators (bots, keepers) who can
/// then manage positions WITHOUT custody — payouts always go to the owner.
contract PermissionsTest is Test {
    MockERC20 internal t0;
    MockERC20 internal t1;
    PermissionRegistry internal registry;
    RollingFrontierBook internal book;

    address internal mm; // position owner
    address internal bot; // delegated operator
    address internal taker;

    uint128 internal constant L = 1e18;

    function setUp() public {
        mm = makeAddr("mm");
        bot = makeAddr("bot");
        taker = makeAddr("taker");
        t0 = new MockERC20("T0", "T0");
        t1 = new MockERC20("T1", "T1");
        registry = new PermissionRegistry();
        FrontierBookFactory factory = newFactory(address(registry));
        book = RollingFrontierBook(factory.createBook(address(t0), address(t1), 1, 0));

        t0.mint(mm, 1e30);
        vm.prank(mm);
        t0.approve(address(book), type(uint256).max);
        t1.mint(taker, 1e30);
        vm.prank(taker);
        t1.approve(address(book), type(uint256).max);
    }

    function testOperatorRequotesWithGrant() public {
        vm.prank(mm);
        uint256 id = book.deposit(10, 13, L);

        // without a grant the bot is rejected
        vm.prank(bot);
        vm.expectRevert();
        book.requote(id, 20, 23, L);

        // selector-scoped grant: requote only
        vm.prank(mm);
        registry.grant(bot, address(book), book.requote.selector);

        vm.prank(bot);
        book.requote(id, 20, 23, L); // bot manages the quote
        assertEq(book.activeLiquidity(20), L, "bot moved the owner's quote");

        // but the bot cannot cancel (different selector, no custody risk)
        vm.prank(bot);
        vm.expectRevert();
        book.cancel(id);
    }

    function testOperatorClaimPaysOwnerNotOperator() public {
        vm.prank(mm);
        uint256 id = book.deposit(10, 12, L);
        vm.prank(taker);
        book.moveTickTo(12);

        vm.prank(mm);
        registry.grant(bot, address(book), book.claim.selector);

        vm.prank(bot);
        uint256 paid = book.claim(id);
        assertGt(paid, 0, "claim happened");
        assertEq(t1.balanceOf(mm), paid, "proceeds went to the OWNER");
        assertEq(t1.balanceOf(bot), 0, "operator received nothing");
    }

    function testExpiryEndsDelegation() public {
        vm.prank(mm);
        uint256 id = book.deposit(10, 13, L);
        vm.prank(mm);
        registry.grantWithExpiry(bot, address(book), book.requote.selector, uint48(block.timestamp + 1 hours));

        vm.prank(bot);
        book.requote(id, 20, 23, L); // works while live

        vm.warp(block.timestamp + 2 hours);
        vm.prank(bot);
        vm.expectRevert();
        book.requote(id, 30, 33, L); // expired
    }

    function testFullTargetGrantCoversEverything() public {
        vm.prank(mm);
        uint256 id = book.deposit(10, 12, L);
        vm.prank(taker);
        book.moveTickTo(11);

        vm.prank(mm);
        registry.grantFull(bot, address(book));

        vm.startPrank(bot);
        book.claim(id);
        book.cancel(id); // full-target: any selector
        vm.stopPrank();
        assertGt(t0.balanceOf(mm), 1e30 - 3 * uint256(L), "principal returned to owner");
    }

    function testNoRegistryMeansOwnerOnly() public {
        // a book created without a registry keeps strict owner-only behavior
        FrontierBookFactory bare = newFactory(address(0));
        RollingFrontierBook bareBook = RollingFrontierBook(bare.createBook(address(t0), address(t1), 1, 0));
        vm.prank(mm);
        t0.approve(address(bareBook), type(uint256).max);
        vm.prank(mm);
        uint256 id = bareBook.deposit(10, 12, L);

        vm.prank(bot);
        vm.expectRevert(bytes("not owner"));
        bareBook.requote(id, 20, 22, L);
    }
}
