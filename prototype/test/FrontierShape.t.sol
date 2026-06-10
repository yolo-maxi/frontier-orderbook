// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {MockERC20} from "../src/MockERC20.sol";
import {RollingFrontierBook} from "../src/RollingFrontierBook.sol";
import {newBook} from "./utils/BookFab.sol";

/// @notice Shaped (linear-ladder) orders: one position carries a per-level
/// size profile L0 + slope*j via second-order frontier deltas. Verified
/// against brute-force per-level sums computed in the test.
contract FrontierShapeTest is Test {
    MockERC20 internal t0;
    MockERC20 internal t1;
    RollingFrontierBook internal book;

    address internal mm;
    address internal mm2;
    address internal taker;

    uint128 internal constant L = 1e18;

    function setUp() public {
        mm = makeAddr("mm");
        mm2 = makeAddr("mm2");
        taker = makeAddr("taker");
        _fresh();
    }

    function _fresh() internal {
        t0 = new MockERC20("T0", "T0");
        t1 = new MockERC20("T1", "T1");
        book = newBook(address(t0), address(t1), 1, 0, address(0), address(0));
        address[2] memory makers = [mm, mm2];
        for (uint256 i = 0; i < 2; i++) {
            t0.mint(makers[i], 1e30);
            vm.prank(makers[i]);
            t0.approve(address(book), type(uint256).max);
        }
        t1.mint(taker, 1e30);
        vm.prank(taker);
        t1.approve(address(book), type(uint256).max);
    }

    function sizeAt(uint128 l0, int128 m, uint24 j) internal pure returns (uint256) {
        return uint256(int256(uint256(l0)) + int256(m) * int256(uint256(j)));
    }

    function rate(int24 t) internal pure returns (uint256) {
        return uint256(int256(1e18) + int256(t) * 1e15);
    }

    /// @dev brute-force expected proceeds for levels [a, b) of a shaped order
    function bruteAmt1(int24 lower, uint128 l0, int128 m, int24 a, int24 b) internal pure returns (uint256 tot) {
        // per-position payout floors ONCE over the span; sum exact values then floor
        uint256 acc;
        for (int24 t = a; t < b; t++) {
            acc += sizeAt(l0, m, uint24(t - lower)) * rate(t);
        }
        return acc / 1e18;
    }

    // ------------------------------------------------------------------
    // Front-loaded ladder: big at the touch, decaying outward
    // ------------------------------------------------------------------

    function testDecayingLadderFillsAndClaims() public {
        // 10 levels: 10L, 9L, ..., 1L
        uint128 l0 = 10 * L;
        int128 m = -int128(L);
        uint256 mmBal = t0.balanceOf(mm);
        vm.prank(mm);
        uint256 id = book.depositShaped(10, 20, l0, m);

        // principal = 10+9+...+1 = 55 L
        assertEq(mmBal - t0.balanceOf(mm), 55 * uint256(L), "shaped principal");

        // aggregate sizes visible per level
        assertEq(book.activeLiquidity(10), 10 * L, "level 0 size");
        assertEq(book.activeLiquidity(14), 6 * L, "level 4 size");
        assertEq(book.activeLiquidity(19), L, "level 9 size");

        // taker sweeps 3 levels: pays for 10L+9L+8L at the level rates,
        // receives exactly that much token0
        uint256 taker0 = t0.balanceOf(taker);
        vm.prank(taker);
        book.moveTickTo(13);
        assertEq(t0.balanceOf(taker) - taker0, 27 * uint256(L), "taker got the shaped sizes");

        assertEq(book.claimable(id), bruteAmt1(10, l0, m, 10, 13), "shaped claim matches brute force");
        vm.prank(mm);
        book.claim(id);
        assertEq(t1.balanceOf(mm), bruteAmt1(10, l0, m, 10, 13), "paid out");
        assertEq(book.unfilledPrincipal(id), (55 - 27) * uint256(L), "remaining principal");
    }

    function testShapedCancelReturnsTailExactly() public {
        uint128 l0 = 10 * L;
        int128 m = -int128(L);
        vm.prank(mm);
        uint256 id = book.depositShaped(10, 20, l0, m);
        vm.prank(taker);
        book.moveTickTo(13); // consumes 10+9+8 = 27L

        uint256 t0Before = t0.balanceOf(mm);
        vm.prank(mm);
        (uint256 proceeds1, uint256 principal0) = book.cancel(id);
        assertEq(proceeds1, bruteAmt1(10, l0, m, 10, 13), "filled levels paid");
        assertEq(principal0, 28 * uint256(L), "tail 7+6+...+1 returned");
        assertEq(t0.balanceOf(mm) - t0Before, principal0, "real tokens back");

        // deltas and slopes fully cleaned: nothing left anywhere
        int256 dSum;
        int256 sSum;
        for (int24 t = 0; t <= 30; t++) {
            dSum += book.frontierDelta(t);
            sSum += book.frontierSlope(t);
            assertEq(book.activeLiquidity(t), 0, "book empty");
        }
        assertEq(dSum, 0, "value deltas conserved");
        assertEq(sSum, 0, "slope deltas conserved");
    }

    // ------------------------------------------------------------------
    // Mixed book: shaped + uniform + opposing shape, partial sweep
    // ------------------------------------------------------------------

    function testMixedShapesAggregateCorrectly() public {
        // mm: decaying 5..1 over [10,15); mm2: rising 1..5 over [12,17) + uniform [10,12)
        vm.prank(mm);
        uint256 a = book.depositShaped(10, 15, 5 * L, -int128(L));
        vm.prank(mm2);
        uint256 b = book.depositShaped(12, 17, L, int128(L));
        vm.prank(mm2);
        uint256 c = book.deposit(10, 12, L);

        // aggregate per level: 10:5+1, 11:4+1, 12:3+1, 13:2+2, 14:1+3, 15:4, 16:5
        assertEq(book.activeLiquidity(10), 6 * L);
        assertEq(book.activeLiquidity(12), 4 * L);
        assertEq(book.activeLiquidity(14), 4 * L);
        assertEq(book.activeLiquidity(16), 5 * L);

        vm.prank(taker);
        book.moveTickTo(15); // sweep five levels

        assertEq(book.claimable(a), bruteAmt1(10, 5 * L, -int128(L), 10, 15), "decaying fully paid");
        assertEq(book.claimable(b), bruteAmt1(12, L, int128(L), 12, 15), "rising partially paid");
        assertEq(book.claimable(c), bruteAmt1(10, L, 0, 10, 12), "uniform fully paid");
        assertEq(book.activeLiquidity(15), 4 * L, "rising tail intact");
        assertEq(book.unfilledPrincipal(b), 9 * uint256(L), "rising tail 4+5");
    }

    // ------------------------------------------------------------------
    // O(1) properties carry over to shapes
    // ------------------------------------------------------------------

    function testShapedDepositAndRequoteWidthIndependent() public {
        uint24[2] memory widths = [uint24(100), 10000];
        uint256[2] memory depGas;
        uint256[2] memory reqGas;
        for (uint256 i = 0; i < 2; i++) {
            _fresh();
            vm.prank(mm);
            uint256 g = gasleft();
            uint256 id = book.depositShaped(1000, 1000 + int24(widths[i]), uint128(widths[i]) * L, -int128(L));
            depGas[i] = g - gasleft();
            vm.prank(mm);
            g = gasleft();
            book.requoteShaped(id, 2000, 2000 + int24(widths[i]), uint128(widths[i]) * L, -int128(L));
            reqGas[i] = g - gasleft();
        }
        console2.log("shaped deposit gas at widths 100/10000:", depGas[0], depGas[1]);
        console2.log("shaped requote gas at widths 100/10000:", reqGas[0], reqGas[1]);
        // tolerance covers calldata-byte differences between widths
        assertApproxEqAbs(depGas[0], depGas[1], 50, "shaped deposit O(1) in width");
        assertApproxEqAbs(reqGas[0], reqGas[1], 50, "shaped requote O(1) in width");
    }

    function testReshapeOnRequote() public {
        // flat ladder becomes front-loaded without leaving the position
        vm.prank(mm);
        uint256 id = book.deposit(10, 20, L); // 10 levels of L
        uint256 mmBal = t0.balanceOf(mm);

        vm.prank(mm);
        book.requoteShaped(id, 10, 20, 10 * L, -int128(L)); // 10..1, total 55L
        assertEq(mmBal - t0.balanceOf(mm), 45 * uint256(L), "pulled only the size difference");
        assertEq(book.activeLiquidity(10), 10 * L, "front-loaded");
        assertEq(book.activeLiquidity(19), L, "tail thin");
    }

    function testShapeFloorIsEnforced() public {
        // would hit size 0 on the last level
        vm.prank(mm);
        vm.expectRevert(bytes("level size < 1"));
        book.depositShaped(10, 21, 10 * L, -int128(L)); // 11 levels: 10L..0

        // negative interior is impossible for linear (endpoints checked)
        vm.prank(mm);
        vm.expectRevert(bytes("level size < 1"));
        book.depositShaped(10, 20, L, -int128(L));
    }
}
