// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MockERC20} from "../src/MockERC20.sol";
import {UniformFrontierBook} from "../src/UniformFrontierBook.sol";
import {FrontierPositionNFT} from "../src/periphery/FrontierPositionNFT.sol";
import {PermissionRegistry} from "../src/permissions/PermissionRegistry.sol";
import {newBook} from "./utils/BookFab.sol";

/// @notice ERC-721 wrapper: positions as standard NFTs, proceeds follow the
/// holder, wrap/unwrap via the permission registry.
contract PositionNFTTest is Test {
    MockERC20 internal t0;
    MockERC20 internal t1;
    PermissionRegistry internal registry;
    UniformFrontierBook internal book;
    FrontierPositionNFT internal nft;

    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal taker = makeAddr("taker");

    uint128 internal constant L = 1e18;

    function setUp() public {
        t0 = new MockERC20("T0", "T0");
        t1 = new MockERC20("T1", "T1");
        registry = new PermissionRegistry();
        book = newBook(address(t0), address(t1), 1, 0, address(0), address(registry));
        nft = new FrontierPositionNFT(book);

        for (uint256 i = 0; i < 2; i++) {
            address u = i == 0 ? alice : taker;
            t0.mint(u, 1e30);
            t1.mint(u, 1e30);
            vm.startPrank(u);
            t0.approve(address(book), type(uint256).max);
            t1.approve(address(book), type(uint256).max);
            t0.approve(address(nft), type(uint256).max);
            t1.approve(address(nft), type(uint256).max);
            vm.stopPrank();
        }
    }

    function testMintClaimFollowsHolder() public {
        vm.prank(alice);
        uint256 tokenId = nft.mintAsk(1, 101, L);
        assertEq(nft.ownerOf(tokenId), alice);

        vm.prank(taker);
        book.moveTickTo(51); // half the ladder fills

        // transfer the NFT: future proceeds belong to bob
        vm.prank(alice);
        nft.transferFrom(alice, bob, tokenId);

        vm.prank(bob);
        uint256 got = nft.claim(tokenId);
        assertGt(got, 0, "filled levels claimable");
        assertEq(t1.balanceOf(bob), got, "proceeds follow the holder");

        // alice can no longer manage it
        vm.prank(alice);
        vm.expectRevert(bytes("not authorized"));
        nft.claim(tokenId);
    }

    function testCancelPaysHolderBothLegs() public {
        vm.prank(alice);
        uint256 tokenId = nft.mintAsk(1, 101, L);

        vm.prank(taker);
        book.moveTickTo(51);

        uint256 b1 = t1.balanceOf(alice);
        uint256 b0 = t0.balanceOf(alice);
        vm.prank(alice);
        (uint256 proceeds1, uint256 refund0) = nft.cancel(tokenId);
        assertGt(proceeds1, 0);
        assertEq(refund0, 50 * uint256(L), "unfilled principal back");
        assertEq(t1.balanceOf(alice) - b1, proceeds1);
        assertEq(t0.balanceOf(alice) - b0, refund0);

        vm.expectRevert(bytes("no token"));
        nft.ownerOf(tokenId);
    }

    function testBidMintAndClaim() public {
        vm.prank(taker);
        book.moveTickTo(101);
        vm.prank(alice);
        uint256 tokenId = nft.mintBid(1, 101, L);
        assertEq(t1.balanceOf(address(nft)), 0, "no estimate dust parked in the wrapper");

        vm.prank(taker);
        book.sweepWithLimits(1, type(uint256).max, type(uint256).max, 0, block.timestamp);

        vm.prank(alice);
        uint256 got0 = nft.claimBid(tokenId);
        assertEq(got0, 100 * uint256(L), "bid bought the full ladder");
    }

    function testWrapAndUnwrapExistingPosition() public {
        vm.startPrank(alice);
        uint256 positionId = book.deposit(1, 101, L);
        // one-time grant lets the wrapper pull positions alice asks it to
        registry.grant(address(nft), address(book), book.transferPosition.selector);
        uint256 tokenId = nft.wrap(positionId);
        vm.stopPrank();

        (address owner,,,,,,,) = book.positions(positionId);
        assertEq(owner, address(nft), "book position custodied by the wrapper");
        assertEq(nft.ownerOf(tokenId), alice);

        // bob cannot wrap what isn't his
        vm.prank(bob);
        vm.expectRevert(bytes("not live"));
        nft.wrap(999);

        vm.prank(alice);
        nft.unwrap(tokenId);
        (owner,,,,,,,) = book.positions(positionId);
        assertEq(owner, alice, "raw position handed back");
        vm.expectRevert(bytes("no token"));
        nft.ownerOf(tokenId);
    }

    function testWrapRejectsNonOwner() public {
        vm.prank(alice);
        uint256 positionId = book.deposit(1, 101, L);
        vm.prank(bob);
        vm.expectRevert(bytes("not position owner"));
        nft.wrap(positionId);
    }
}
