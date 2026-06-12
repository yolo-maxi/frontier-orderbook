// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MockERC20} from "../src/MockERC20.sol";
import {RollingFrontierBook} from "../src/RollingFrontierBook.sol";
import {GeometricFrontierBook} from "../src/GeometricFrontierBook.sol";
import {GeoTickMath} from "../src/curve/GeoTickMath.sol";
import {newBook, newGeoBook} from "./utils/BookFab.sol";

contract ShortTransferToken {
    string public name = "Short";
    string public symbol = "SHORT";
    uint8 public constant decimals = 18;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        uint256 moved = amount == 0 ? 0 : amount - 1;
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += moved;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) allowance[from][msg.sender] = allowed - amount;
        uint256 moved = amount == 0 ? 0 : amount - 1;
        balanceOf[from] -= amount;
        balanceOf[to] += moved;
        return true;
    }
}

contract FrontierAuditFixesTest is Test {
    address internal maker = makeAddr("maker");
    address internal taker = makeAddr("taker");

    function testDepositRejectsNonExactToken0Transfer() public {
        ShortTransferToken t0 = new ShortTransferToken();
        MockERC20 t1 = new MockERC20("T1", "T1");
        RollingFrontierBook book = newBook(address(t0), address(t1), 1, 0, address(0), address(0));

        t0.mint(maker, 10e18);
        vm.startPrank(maker);
        t0.approve(address(book), type(uint256).max);
        vm.expectRevert(bytes("non-exact token0 transfer"));
        book.deposit(1, 2, 1e18);
        vm.stopPrank();
    }

    function testSweepRejectsNonExactToken1Payment() public {
        MockERC20 t0 = new MockERC20("T0", "T0");
        ShortTransferToken t1 = new ShortTransferToken();
        RollingFrontierBook book = newBook(address(t0), address(t1), 1, 0, address(0), address(0));

        t0.mint(maker, 10e18);
        vm.startPrank(maker);
        t0.approve(address(book), type(uint256).max);
        book.deposit(1, 2, 1e18);
        vm.stopPrank();

        t1.mint(taker, 10e18);
        vm.startPrank(taker);
        t1.approve(address(book), type(uint256).max);
        vm.expectRevert(bytes("non-exact token1 transfer"));
        book.moveTickTo(2);
        vm.stopPrank();
    }

    function testGeometricRejectsOutOfDomainRangesAndSweeps() public {
        MockERC20 t0 = new MockERC20("T0", "T0");
        MockERC20 t1 = new MockERC20("T1", "T1");
        GeometricFrontierBook book = newGeoBook(address(t0), address(t1), 1, 0, address(0), address(0));

        t0.mint(maker, 10e18);
        t1.mint(maker, 10e18);
        vm.startPrank(maker);
        t0.approve(address(book), type(uint256).max);
        t1.approve(address(book), type(uint256).max);

        vm.expectRevert(bytes("geometric: tick out of range"));
        book.deposit(GeoTickMath.MAX_TICK, GeoTickMath.MAX_TICK + 1, 1e18);

        vm.expectRevert(bytes("geometric: tick out of range"));
        book.depositBid(-GeoTickMath.MAX_TICK - 1, -GeoTickMath.MAX_TICK, 1e18);
        vm.stopPrank();

        vm.prank(taker);
        vm.expectRevert(bytes("geometric: tick out of range"));
        book.sweepWithLimits(GeoTickMath.MAX_TICK + 1, type(uint256).max, type(uint256).max, 0, block.timestamp);
    }

    function testInternalClaimedCreditMovesWithPositionOrBlocksIfSpent() public {
        MockERC20 t0 = new MockERC20("T0", "T0");
        MockERC20 t1 = new MockERC20("T1", "T1");
        RollingFrontierBook book = newBook(address(t0), address(t1), 1, 0, address(0), address(0));
        address bob = makeAddr("bob");

        t0.mint(maker, 10e18);
        t1.mint(taker, 10e18);
        vm.prank(maker);
        t0.approve(address(book), type(uint256).max);
        vm.prank(taker);
        t1.approve(address(book), type(uint256).max);

        vm.prank(maker);
        uint256 id = book.deposit(1, 2, 1e18);
        vm.prank(taker);
        book.moveTickTo(2);
        vm.prank(maker);
        uint256 credited = book.claimInternal(id);

        vm.prank(maker);
        book.transferPosition(id, bob);
        assertEq(book.internalBalance1(maker), 0, "old owner no longer has position credit");
        assertEq(book.internalBalance1(bob), credited, "new owner receives unwithdrawn position credit");

        vm.prank(bob);
        book.withdrawInternal(0, credited);
        vm.prank(bob);
        vm.expectRevert(bytes("internal credit spent"));
        book.transferPosition(id, maker);
    }

    function testBidRefundableFloorAndEscrowedCeilAreDistinct() public {
        MockERC20 t0 = new MockERC20("T0", "T0");
        MockERC20 t1 = new MockERC20("T1", "T1");
        RollingFrontierBook book = newBook(address(t0), address(t1), 1, 10, address(0), address(0));

        t1.mint(maker, 10);
        vm.startPrank(maker);
        t1.approve(address(book), type(uint256).max);
        uint256 id = book.depositBid(1, 2, 1);
        vm.stopPrank();

        assertEq(book.bidRefundable(id), 1, "legacy view is floor-rounded");
        assertEq(book.bidEscrowed(id), 2, "exact escrow view is ceil-rounded");
        assertEq(book.quoteBidPrincipal(1, 2, 1), 2, "fresh bid quote matches escrow rounding");
    }
}
