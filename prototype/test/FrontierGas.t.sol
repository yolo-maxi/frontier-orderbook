// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {MockERC20} from "../src/MockERC20.sol";
import {RollingFrontierBook} from "../src/RollingFrontierBook.sol";

/// @notice Gas proofs for the rolling-frontier book: deposit, witness-claim,
/// and witness-cancel must be flat in RANGE WIDTH (the spec's "desired but
/// unproven" R9 property), on top of the user-count independence the bucket
/// design already had.
contract FrontierGasTest is Test {
    MockERC20 internal t0;
    MockERC20 internal t1;
    RollingFrontierBook internal book;

    uint128 internal constant L = 1e15;

    function _fresh(int24 startTick) internal {
        t0 = new MockERC20("T0", "T0");
        t1 = new MockERC20("T1", "T1");
        book = new RollingFrontierBook(address(t0), address(t1), 1, startTick);
        t1.mint(address(this), 1e30);
        t1.approve(address(book), type(uint256).max);
    }

    function _user(uint256 i) internal returns (address u) {
        u = makeAddr(string(abi.encodePacked("fuser", vm.toString(i))));
        t0.mint(u, 1e30);
        vm.prank(u);
        t0.approve(address(book), type(uint256).max);
    }

    // ------------------------------------------------------------------
    // Width independence — the new property
    // ------------------------------------------------------------------

    function testDepositGasFlatVsWidth() public {
        // Note: a deposit whose endpoints share one 256-interval bitmap word
        // (width <~ 256 * spacing) saves one cold word-write (~22k) — a
        // two-value step, not width scaling. Flatness is asserted across the
        // multi-word regime, where cost must be bit-identical.
        uint24[4] memory widths = [uint24(10), 1000, 10000, 100000];
        uint256[4] memory gasUsed;
        for (uint256 c = 0; c < widths.length; c++) {
            _fresh(9);
            address u = _user(0);
            vm.prank(u);
            uint256 g = gasleft();
            book.deposit(10, 10 + int24(widths[c]), L);
            gasUsed[c] = g - gasleft();
            console2.log("frontier deposit gas at width:", widths[c], gasUsed[c]);
        }
        assertEq(gasUsed[1], gasUsed[3], "deposit must be O(1) in width (multi-word regime)");
        assertLe(gasUsed[1] - gasUsed[0], 25_000, "single-word discount is one cold word write");
    }

    function testClaimGasFlatVsWidth() public {
        uint24[3] memory widths = [uint24(10), 1000, 100000];
        uint256[3] memory gasUsed;
        for (uint256 c = 0; c < widths.length; c++) {
            _fresh(9);
            address u = _user(0);
            vm.prank(u);
            uint256 id = book.deposit(10, 10 + int24(widths[c]), L);
            book.moveTickTo(12); // fill first two intervals

            vm.prank(u);
            uint256 g = gasleft();
            book.claimTo(id, 12);
            gasUsed[c] = g - gasleft();
            console2.log("frontier witness-claim gas at width:", widths[c], gasUsed[c]);
        }
        assertApproxEqRel(gasUsed[0], gasUsed[2], 0.05e18, "witness claim must be O(1) in width");
    }

    function testCancelGasFlatVsWidth() public {
        uint24[3] memory widths = [uint24(10), 1000, 100000];
        uint256[3] memory gasUsed;
        for (uint256 c = 0; c < widths.length; c++) {
            _fresh(9);
            address u = _user(0);
            vm.prank(u);
            uint256 id = book.deposit(10, 10 + int24(widths[c]), L);
            book.moveTickTo(12);

            vm.prank(u);
            uint256 g = gasleft();
            book.cancelWithWitness(id, 12);
            gasUsed[c] = g - gasleft();
            console2.log("frontier witness-cancel gas at width:", widths[c], gasUsed[c]);
        }
        assertApproxEqRel(gasUsed[0], gasUsed[2], 0.05e18, "witness cancel must be O(1) in width");
    }

    // ------------------------------------------------------------------
    // User-count independence — must still hold
    // ------------------------------------------------------------------

    function testSwapGasIndependentOfUserCount() public {
        uint256[2] memory counts = [uint256(1), 100];
        uint256[2] memory gasUsed;
        for (uint256 c = 0; c < counts.length; c++) {
            _fresh(9);
            for (uint256 i = 0; i < counts[c]; i++) {
                address u = _user(i);
                vm.prank(u);
                book.deposit(10, 12, L);
            }
            uint256 g = gasleft();
            book.moveTickTo(12);
            gasUsed[c] = g - gasleft();
            console2.log("frontier swap gas with N users:", counts[c], gasUsed[c]);
        }
        assertApproxEqRel(gasUsed[0], gasUsed[1], 0.05e18, "swap gas must not grow with users");
    }

    function testSwapGasScalesOnlyWithCrossedIntervals() public {
        uint24[3] memory crossed = [uint24(1), 10, 50];
        uint256[3] memory gasUsed;
        for (uint256 c = 0; c < crossed.length; c++) {
            _fresh(9);
            address u = _user(0);
            vm.prank(u);
            book.deposit(10, 10 + int24(crossed[c]), L);
            uint256 g = gasleft();
            book.moveTickTo(10 + int24(crossed[c]));
            gasUsed[c] = g - gasleft();
            console2.log("frontier swap gas crossing intervals:", crossed[c], gasUsed[c]);
        }
        assertGt(gasUsed[2], gasUsed[1], "expected crossed-interval scaling (allowed by S5)");
    }

    // ------------------------------------------------------------------
    // Fragmentation canary — history depth must not matter
    // ------------------------------------------------------------------

    function testHistoricalFragmentationCanary() public {
        uint256[2] memory lifecycles = [uint256(2), 40];
        uint256[2] memory gasUsed;
        for (uint256 c = 0; c < lifecycles.length; c++) {
            _fresh(9);
            address churner = _user(1);
            for (uint256 k = 0; k < lifecycles[c]; k++) {
                vm.prank(churner);
                book.deposit(10, 11, L);
                book.moveTickTo(11);
                book.moveTickTo(9);
            }
            address probe = _user(999);
            vm.prank(probe);
            uint256 id = book.deposit(10, 100000, L); // very wide, after heavy churn
            book.moveTickTo(11);

            vm.prank(probe);
            uint256 g = gasleft();
            book.claimTo(id, 11);
            gasUsed[c] = g - gasleft();
            console2.log("frontier claim gas after K lifecycles:", lifecycles[c], gasUsed[c]);
        }
        assertApproxEqRel(gasUsed[0], gasUsed[1], 0.05e18, "claim gas must not grow with history");
    }
}
