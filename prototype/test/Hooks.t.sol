// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {MockERC20} from "../src/MockERC20.sol";
import {RollingFrontierBook} from "../src/RollingFrontierBook.sol";
import {FrontierBookFactory} from "../src/FrontierBookFactory.sol";
import {FrontierHookFlags} from "../src/hooks/IFrontierHooks.sol";
import {GatedVolumeHook} from "../src/hooks/examples/ExampleHooks.sol";

/// @notice v4-style hooks: permissions live in the hook contract's ADDRESS
/// low bits; callbacks must return their selector; flagless addresses are
/// never called.
contract HooksTest is Test {
    MockERC20 internal t0;
    MockERC20 internal t1;
    FrontierBookFactory internal factory;
    GatedVolumeHook internal hook;
    RollingFrontierBook internal book;

    address internal mm;
    address internal taker;

    uint128 internal constant L = 1e18;

    function setUp() public {
        mm = makeAddr("mm");
        taker = makeAddr("taker");
        t0 = new MockERC20("T0", "T0");
        t1 = new MockERC20("T1", "T1");
        factory = new FrontierBookFactory(address(0));

        // deploy the hook at an address with its permission flags encoded
        uint160 flags = FrontierHookFlags.BEFORE_DEPOSIT_FLAG | FrontierHookFlags.AFTER_SWEEP_FLAG;
        address hookAddr = address((uint160(0xBEEF) << 20) | flags);
        deployCodeTo("ExampleHooks.sol:GatedVolumeHook", abi.encode(address(this)), hookAddr);
        hook = GatedVolumeHook(hookAddr);

        book = RollingFrontierBook(factory.createBookWithHooks(address(t0), address(t1), 1, 0, hookAddr));

        t0.mint(mm, 1e30);
        vm.prank(mm);
        t0.approve(address(book), type(uint256).max);
        t1.mint(taker, 1e30);
        vm.prank(taker);
        t1.approve(address(book), type(uint256).max);
    }

    function testBeforeDepositGate() public {
        vm.prank(mm);
        vm.expectRevert(bytes("hook rejected"));
        book.deposit(10, 12, L);

        hook.setAllowed(mm, true);
        vm.prank(mm);
        book.deposit(10, 12, L); // allowlisted maker passes
        assertEq(book.activeLiquidity(10), L);
    }

    function testAfterSweepObserves() public {
        hook.setAllowed(mm, true);
        vm.prank(mm);
        book.deposit(10, 12, L);

        vm.prank(taker);
        book.moveTickTo(12);

        assertEq(hook.totalSweeps(), 1, "sweep observed");
        assertEq(hook.totalToken0Volume(), 2 * uint256(L), "volume recorded");
    }

    function testUnflaggedCallbacksAreSkipped() public {
        // afterClaim flag NOT in the hook address: claims work with no
        // callback even though the hook implements the function
        hook.setAllowed(mm, true);
        vm.prank(mm);
        uint256 id = book.deposit(10, 12, L);
        vm.prank(taker);
        book.moveTickTo(12);
        vm.prank(mm);
        book.claim(id); // would revert if the (unflagged) callback were called and miscounted
    }

    function testHooklessBookUntouched() public {
        RollingFrontierBook plain = RollingFrontierBook(factory.createBook(address(t0), address(t1), 1, 0));
        vm.prank(mm);
        t0.approve(address(plain), type(uint256).max);
        vm.prank(mm);
        plain.deposit(10, 12, L); // no allowlist, no hook, just works
    }
}
