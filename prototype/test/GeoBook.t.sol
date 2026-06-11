// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {MockERC20} from "../src/MockERC20.sol";
import {GeometricFrontierBook} from "../src/GeometricFrontierBook.sol";
import {GeoTickMath} from "../src/curve/GeoTickMath.sol";
import {newGeoBook} from "./utils/BookFab.sol";

/// @notice The production 1.0001^tick curve: pow accuracy, exact telescoped
/// settlement, rounding solvency under partial claims, and sweep gas parity
/// with the linear curve.
contract GeoBookTest is Test {
    MockERC20 internal t0;
    MockERC20 internal t1;
    GeometricFrontierBook internal book;

    address internal maker = makeAddr("maker");
    address internal maker2 = makeAddr("maker2");
    address internal taker = makeAddr("taker");

    uint128 internal constant L = 1e18;
    uint256 internal constant X = 1e18;

    function setUp() public {
        t0 = new MockERC20("T0", "T0");
        t1 = new MockERC20("T1", "T1");
        book = newGeoBook(address(t0), address(t1), 1, 0, address(0), address(0));
        for (uint256 i = 0; i < 2; i++) {
            address m = i == 0 ? maker : maker2;
            t0.mint(m, 1e30);
            t1.mint(m, 1e30);
            vm.startPrank(m);
            t0.approve(address(book), type(uint256).max);
            t1.approve(address(book), type(uint256).max);
            vm.stopPrank();
        }
        t0.mint(taker, 1e30);
        t1.mint(taker, 1e30);
        vm.startPrank(taker);
        t0.approve(address(book), type(uint256).max);
        t1.approve(address(book), type(uint256).max);
        vm.stopPrank();
    }

    function geoSpan(int24 a, int24 b, uint256 size, bool up) internal view returns (uint256) {
        uint256 num = size * (GeoTickMath.powX18(b) - GeoTickMath.powX18(a));
        uint256 d = book.geoD();
        return up ? (num + d - 1) / d : num / d;
    }

    // ------------------------------------------------------------------
    // pow accuracy against high-precision references (Python Decimal)
    // ------------------------------------------------------------------

    function testPowAccuracy() public pure {
        // reference values: 1.0001^t * 1e18, 60-digit decimal arithmetic
        int24[8] memory ts = [int24(1), 7, 100, 887, 10000, -1, -100, -10000];
        uint256[8] memory refs = [
            uint256(1000100000000000000),
            1000700210035003500,
            1010049662092876568,
            1092747935288369912,
            2718145926825224864,
            999900009999000099,
            990050328741209481,
            367897834377123709
        ];
        for (uint256 i = 0; i < ts.length; i++) {
            assertApproxEqAbs(GeoTickMath.powX18(ts[i]), refs[i], 50, "pow drift beyond 50 wei-of-X18");
        }
        // monotone across a dense stretch
        uint256 prev = GeoTickMath.powX18(-50);
        for (int24 t = -49; t <= 50; t++) {
            uint256 p = GeoTickMath.powX18(t);
            assertGt(p, prev, "pow must be strictly increasing");
            prev = p;
        }
    }

    // ------------------------------------------------------------------
    // exact telescoped settlement, both sides
    // ------------------------------------------------------------------

    function testAskLifecycleExact() public {
        vm.prank(maker);
        uint256 id = book.deposit(1, 501, L); // 500 thin levels

        vm.prank(taker);
        (, uint256 paid, uint256 received) =
            book.sweepWithLimits(501, type(uint256).max, type(uint256).max, 0, block.timestamp);

        assertEq(received, 500 * uint256(L), "taker buys every level's size");
        assertEq(paid, geoSpan(1, 501, L, true), "taker pays the ceil geometric span");

        uint256 bal = t1.balanceOf(maker);
        vm.prank(maker);
        book.claim(id);
        assertEq(t1.balanceOf(maker) - bal, geoSpan(1, 501, L, false), "maker claims the floor geometric span");
    }

    function testBidLifecycleExact() public {
        vm.prank(taker);
        book.moveTickTo(301);
        vm.prank(maker);
        uint256 id = book.depositBid(1, 301, L);

        vm.prank(taker);
        (, uint256 paid, uint256 received) =
            book.sweepWithLimits(1, type(uint256).max, type(uint256).max, 0, block.timestamp);

        assertEq(paid, 300 * uint256(L), "taker delivers every level's size");
        assertEq(received, geoSpan(1, 301, L, false), "taker receives the floor geometric span");

        uint256 bal = t0.balanceOf(maker);
        vm.prank(maker);
        book.claimBid(id);
        assertEq(t0.balanceOf(maker) - bal, 300 * uint256(L), "maker buys exactly the ladder size");
    }

    // ------------------------------------------------------------------
    // rounding solvency: partial claims telescope against the ceil deposit
    // ------------------------------------------------------------------

    function testPartialClaimsNeverExceedTakerPayment() public {
        vm.prank(maker);
        uint256 id = book.deposit(1, 301, L);

        uint256 takerPaid;
        uint256 makerGot;
        // three partial sweeps, each followed by a claim — every claim is
        // floored independently; the sum must stay under the ceil payments
        int24[3] memory stops = [int24(101), 201, 301];
        for (uint256 i = 0; i < 3; i++) {
            vm.prank(taker);
            (, uint256 paid,) =
                book.sweepWithLimits(stops[i], type(uint256).max, type(uint256).max, 0, block.timestamp);
            takerPaid += paid;
            uint256 bal = t1.balanceOf(maker);
            vm.prank(maker);
            book.claim(id);
            makerGot += t1.balanceOf(maker) - bal;
        }
        assertLe(makerGot, takerPaid, "solvent under any claim schedule");
        assertLe(takerPaid - makerGot, 3, "dust bounded by one wei per rounding event");
        // and the three partial claims equal the whole-span value to <= 2 wei
        assertApproxEqAbs(makerGot, geoSpan(1, 301, L, false), 2, "parts telescope to the whole");
    }

    function testShapesDisabled() public {
        vm.prank(maker);
        vm.expectRevert(bytes("geometric: uniform only"));
        book.depositShaped(1, 101, L, 1);
    }

    // ------------------------------------------------------------------
    // telescoping survives the curve swap: O(endpoints), not O(levels)
    // ------------------------------------------------------------------

    function testGeometricSweepGasIndependentOfTickFineness() public {
        uint24[2] memory levels = [uint24(50), 5000];
        uint256[2] memory gasUsed;
        for (uint256 c = 0; c < levels.length; c++) {
            GeometricFrontierBook b2 = newGeoBook(address(t0), address(t1), 1, 0, address(0), address(0));
            vm.startPrank(maker);
            t0.approve(address(b2), type(uint256).max);
            b2.deposit(1, 1 + int24(levels[c]), L);
            vm.stopPrank();
            vm.startPrank(taker);
            t1.approve(address(b2), type(uint256).max);
            uint256 g = gasleft();
            b2.moveTickTo(1 + int24(levels[c]));
            gasUsed[c] = g - gasleft();
            vm.stopPrank();
            console2.log("geometric sweep gas (levels):", levels[c], gasUsed[c]);
        }
        // with the two-level bitmap the wide sweep can even be CHEAPER than
        // the narrow one (gap navigation is ~O(1)), so bound the absolute
        // difference rather than assuming cost grows with fineness
        uint256 diff = gasUsed[1] > gasUsed[0] ? gasUsed[1] - gasUsed[0] : gasUsed[0] - gasUsed[1];
        uint256 wordBudget = (uint256(levels[1] - levels[0]) / 256 + 2) * 2600;
        assertLt(diff, wordBudget, "still word-bounded under the geometric curve");
    }
}
