// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {MockERC20} from "../src/MockERC20.sol";
import {UniformFrontierBook} from "../src/UniformFrontierBook.sol";
import {newBook} from "./utils/BookFab.sol";

/// @notice Gas proofs for the rolling-frontier book: deposit, witness-claim,
/// and witness-cancel must be flat in RANGE WIDTH (the spec's "desired but
/// unproven" R9 property), on top of the user-count independence the bucket
/// design already had.
contract FrontierGasTest is Test {
    MockERC20 internal t0;
    MockERC20 internal t1;
    UniformFrontierBook internal book;

    uint128 internal constant L = 1e15;

    function _fresh(int24 startTick) internal {
        t0 = new MockERC20("T0", "T0");
        t1 = new MockERC20("T1", "T1");
        book = newBook(address(t0), address(t1), 1, startTick, address(0), address(0));
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
        // calldata bytes differ across widths (16 gas per nonzero byte), so
        // allow a tiny absolute tolerance instead of demanding bit-equality
        assertApproxEqAbs(gasUsed[1], gasUsed[3], 50, "deposit must be O(1) in width (multi-word regime)");
        assertLe(gasUsed[1] - gasUsed[0], 25_000, "single-word discount is one cold word write");
    }

    /// @dev Proof for the +22k deposit step: cost tracks the number of
    /// BITMAP WORDS the endpoints touch (1 vs 2), not the range width. A
    /// 10-level deposit placed so lower/upper straddle a 256-interval word
    /// boundary costs the same as a 100,000-level deposit; a 10-level
    /// deposit inside one word saves exactly one cold zero->nonzero word
    /// write (~22.1k).
    function testDepositStepIsBitmapWordsNotWidth() public {
        _fresh(9);
        address u = _user(0);
        vm.prank(u);
        uint256 g = gasleft();
        book.deposit(10, 20, L); // width 10, both endpoints in word 0
        uint256 sameWord = g - gasleft();

        _fresh(199);
        u = _user(0);
        vm.prank(u);
        g = gasleft();
        book.deposit(250, 260, L); // width 10, endpoints in words 0 and 1
        uint256 straddle = g - gasleft();

        _fresh(9);
        u = _user(0);
        vm.prank(u);
        g = gasleft();
        book.deposit(10, 100010, L); // width 100,000: endpoints in two words
        uint256 wide = g - gasleft();

        console2.log("deposit width 10, one bitmap word:", sameWord);
        console2.log("deposit width 10, straddling two words:", straddle);
        console2.log("deposit width 100000, two words:", wide);
        assertApproxEqAbs(straddle, wide, 200, "two-word width-10 == two-word width-100k");
        assertApproxEqAbs(straddle - sameWord, 22_100, 500, "step == one cold zero->nonzero word write");
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

    function testSwapGasFlatVsLevelsOfOneOrder() public {
        // the ozempic property: one order spanning N thin levels is ONE
        // endpoint + ONE run — sweep cost must NOT scale with N
        uint24[3] memory widths = [uint24(1), 100, 10000];
        uint256[3] memory gasUsed;
        for (uint256 c = 0; c < widths.length; c++) {
            _fresh(9);
            address u = _user(0);
            vm.prank(u);
            book.deposit(10, 10 + int24(widths[c]), L);
            uint256 g = gasleft();
            book.moveTickTo(10 + int24(widths[c]));
            gasUsed[c] = g - gasleft();
            console2.log("sweep gas, one order spanning levels:", widths[c], gasUsed[c]);
        }
        // residual growth is the bitmap word walk (1 cold read / 256 levels)
        uint256 wordBudget = (uint256(widths[2] - widths[0]) / 256 + 2) * 2600;
        assertLt(gasUsed[2] - gasUsed[0], wordBudget, "growth must be word-bounded, not per-level");
    }

    function testSwapGasScalesWithEndpointsNotLevels() public {
        // N stacked distinct-size orders = N endpoints; same total levels
        uint24[2] memory counts = [uint24(5), 50];
        uint256[2] memory gasUsed;
        for (uint256 c = 0; c < counts.length; c++) {
            _fresh(9);
            for (uint24 i = 0; i < counts[c]; i++) {
                address u = _user(i);
                vm.prank(u);
                book.deposit(int24(10 + int24(i)), int24(11 + int24(i)), uint128(i + 1) * L);
            }
            uint256 g = gasleft();
            book.moveTickTo(int24(10 + int24(counts[c])));
            gasUsed[c] = g - gasleft();
            console2.log("sweep gas with N endpoint orders:", counts[c], gasUsed[c]);
        }
        // end-of-tx refunds (capped at 1/5) compress the isolated ratio; 3x for 10x endpoints holds in both accounting modes
        assertGt(gasUsed[1], gasUsed[0] * 3, "cost scales with endpoints crossed");
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
