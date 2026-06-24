// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.26;

import "../src/FrontierErrors.sol";

import {Test} from "forge-std/Test.sol";
import {MockERC20} from "../src/MockERC20.sol";
import {UniformFrontierBook} from "../src/UniformFrontierBook.sol";
import {PermissionRegistry} from "../src/permissions/PermissionRegistry.sol";
import {IPermissionRegistry} from "../src/permissions/interfaces/IPermissionRegistry.sol";
import {newBook} from "./utils/BookFab.sol";

/// @notice Locks in the keeper-delegation semantics of claimAuto / claimBidAuto.
///
/// Authorization uses the per-entrypoint selector model: `_authOwner` keys off
/// `msg.sig`, which stays `claimAuto.selector` (resp. `claimBidAuto.selector`)
/// even through the internal `claimTo` / `claimBidTo` call. So a delegated
/// keeper must hold a grant for `claimAuto.selector` to drive `claimAuto`; a
/// `claimTo` grant alone does NOT authorize it. Proceeds always route to the
/// position OWNER, never the keeper. The minProceeds guard reverts when the
/// harvested span is below the requested floor.
contract KeeperClaimAutoTest is Test {
    MockERC20 internal t0;
    MockERC20 internal t1;
    PermissionRegistry internal registry;
    UniformFrontierBook internal book;

    address internal mm = makeAddr("mm"); // position owner
    address internal taker = makeAddr("taker");
    address internal keeper = makeAddr("keeper"); // delegated operator

    uint128 internal constant L = 1e18;

    function setUp() public {
        t0 = new MockERC20("T0", "T0");
        t1 = new MockERC20("T1", "T1");
        registry = new PermissionRegistry();
        // start at tick 50 so we have room for asks (above) and bids (below)
        book = newBook(address(t0), address(t1), 1, 50, address(0), address(registry));

        t0.mint(mm, 1e30);
        t1.mint(mm, 1e30);
        t0.mint(taker, 1e30);
        t1.mint(taker, 1e30);

        vm.startPrank(mm);
        t0.approve(address(book), type(uint256).max);
        t1.approve(address(book), type(uint256).max);
        vm.stopPrank();
        vm.startPrank(taker);
        t0.approve(address(book), type(uint256).max);
        t1.approve(address(book), type(uint256).max);
        vm.stopPrank();
    }

    // ------------------------------------------------------------------
    // ASK side: claimAuto
    // ------------------------------------------------------------------

    /// 1. A keeper granted `claimAuto.selector` CAN call claimAuto; proceeds go
    ///    to the OWNER (owner balance increases, keeper balance unchanged).
    function testKeeperWithClaimAutoGrantClaimsForOwner() public {
        vm.prank(mm);
        uint256 id = book.deposit(60, 70, L);
        vm.prank(taker);
        book.moveTickTo(70); // fully filled

        uint256 expected = book.claimable(id);
        assertGt(expected, 0, "has proceeds");

        // owner grants the keeper the EXACT entrypoint selector
        vm.prank(mm);
        registry.grant(keeper, address(book), book.claimAuto.selector);

        uint256 ownerBefore = t1.balanceOf(mm);
        uint256 keeperBefore = t1.balanceOf(keeper);

        vm.prank(keeper);
        uint256 got = book.claimAuto(id, expected);

        assertEq(got, expected, "keeper harvested the frontier span");
        assertEq(t1.balanceOf(mm) - ownerBefore, expected, "proceeds routed to OWNER");
        assertEq(t1.balanceOf(keeper), keeperBefore, "keeper received nothing");
    }

    /// 2a. A keeper with NO grant CANNOT call claimAuto.
    function testKeeperWithNoGrantCannotClaimAuto() public {
        vm.prank(mm);
        uint256 id = book.deposit(60, 70, L);
        vm.prank(taker);
        book.moveTickTo(70);

        vm.prank(keeper);
        vm.expectRevert(
            abi.encodeWithSelector(
                IPermissionRegistry.PermissionDenied.selector,
                mm,
                keeper,
                address(book),
                book.claimAuto.selector
            )
        );
        book.claimAuto(id, 0);
    }

    /// 2b. A keeper with only a `claimTo` grant CANNOT call claimAuto: the
    ///     selector checked is the entrypoint's (`claimAuto.selector`), which
    ///     stays put through the internal `claimTo` call.
    function testKeeperWithOnlyClaimToGrantCannotClaimAuto() public {
        vm.prank(mm);
        uint256 id = book.deposit(60, 70, L);
        vm.prank(taker);
        book.moveTickTo(70);

        // grant covers claimTo, NOT claimAuto
        vm.prank(mm);
        registry.grant(keeper, address(book), book.claimTo.selector);

        vm.prank(keeper);
        vm.expectRevert(
            abi.encodeWithSelector(
                IPermissionRegistry.PermissionDenied.selector,
                mm,
                keeper,
                address(book),
                book.claimAuto.selector
            )
        );
        book.claimAuto(id, 0);

        // sanity: the claimTo grant DOES authorize claimTo itself, and pays owner
        uint256 ownerBefore = t1.balanceOf(mm);
        vm.prank(keeper);
        uint256 got = book.claimTo(id, 70);
        assertGt(got, 0, "claimTo grant authorizes claimTo");
        assertEq(t1.balanceOf(mm) - ownerBefore, got, "claimTo proceeds to owner");
        assertEq(t1.balanceOf(keeper), 0, "keeper received nothing from claimTo");
    }

    /// 3. The minProceeds guard reverts (BelowMinProceeds) when proceeds <
    ///    minProceeds for a keeper call (authorization passes first).
    function testKeeperClaimAutoRevertsBelowMin() public {
        vm.prank(mm);
        uint256 id = book.deposit(60, 70, L);
        vm.prank(taker);
        book.moveTickTo(70);

        uint256 expected = book.claimable(id);

        vm.prank(mm);
        registry.grant(keeper, address(book), book.claimAuto.selector);

        vm.prank(keeper);
        vm.expectRevert(BelowMinProceeds.selector);
        book.claimAuto(id, expected + 1);

        // guard is non-destructive: nothing claimed, a satisfiable call still works
        assertEq(book.claimable(id), expected, "failed guard left position unclaimed");
        uint256 ownerBefore = t1.balanceOf(mm);
        vm.prank(keeper);
        uint256 got = book.claimAuto(id, expected);
        assertEq(got, expected, "subsequent satisfiable claim succeeds");
        assertEq(t1.balanceOf(mm) - ownerBefore, expected, "proceeds to owner");
    }

    // ------------------------------------------------------------------
    // BID side: claimBidAuto
    // ------------------------------------------------------------------

    /// 4a. A keeper granted `claimBidAuto.selector` CAN call claimBidAuto;
    ///     token0 proceeds go to the OWNER, keeper balance unchanged.
    function testKeeperWithClaimBidAutoGrantClaimsForOwner() public {
        vm.prank(mm);
        uint256 id = book.depositBid(30, 40, L);
        vm.prank(taker);
        book.moveTickTo(30); // fully fills the bid

        uint256 expected = book.bidClaimable(id);
        assertGt(expected, 0, "has token0 proceeds");

        vm.prank(mm);
        registry.grant(keeper, address(book), book.claimBidAuto.selector);

        uint256 ownerBefore = t0.balanceOf(mm);
        uint256 keeperBefore = t0.balanceOf(keeper);

        vm.prank(keeper);
        uint256 got = book.claimBidAuto(id, expected);

        assertEq(got, expected, "keeper harvested the bid frontier span");
        assertEq(t0.balanceOf(mm) - ownerBefore, expected, "token0 routed to OWNER");
        assertEq(t0.balanceOf(keeper), keeperBefore, "keeper received nothing");
    }

    /// 4b. A keeper with only a `claimBidTo` grant CANNOT call claimBidAuto.
    function testKeeperWithOnlyClaimBidToGrantCannotClaimBidAuto() public {
        vm.prank(mm);
        uint256 id = book.depositBid(30, 40, L);
        vm.prank(taker);
        book.moveTickTo(30);

        vm.prank(mm);
        registry.grant(keeper, address(book), book.claimBidTo.selector);

        vm.prank(keeper);
        vm.expectRevert(
            abi.encodeWithSelector(
                IPermissionRegistry.PermissionDenied.selector,
                mm,
                keeper,
                address(book),
                book.claimBidAuto.selector
            )
        );
        book.claimBidAuto(id, 0);
    }

    /// 4c. The minProceeds guard reverts (BelowMinProceeds) on the bid side for
    ///     a keeper call.
    function testKeeperClaimBidAutoRevertsBelowMin() public {
        vm.prank(mm);
        uint256 id = book.depositBid(30, 40, L);
        vm.prank(taker);
        book.moveTickTo(30);

        uint256 expected = book.bidClaimable(id);

        vm.prank(mm);
        registry.grant(keeper, address(book), book.claimBidAuto.selector);

        vm.prank(keeper);
        vm.expectRevert(BelowMinProceeds.selector);
        book.claimBidAuto(id, expected + 1);

        assertEq(book.bidClaimable(id), expected, "failed guard left bid unclaimed");
        uint256 ownerBefore = t0.balanceOf(mm);
        vm.prank(keeper);
        uint256 got = book.claimBidAuto(id, expected);
        assertEq(got, expected, "subsequent satisfiable bid claim succeeds");
        assertEq(t0.balanceOf(mm) - ownerBefore, expected, "token0 to owner");
    }
}
