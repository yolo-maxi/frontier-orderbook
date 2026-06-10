// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {MockERC20} from "../src/MockERC20.sol";
import {RangeTakeProfitBook} from "../src/RangeTakeProfitBook.sol";

/// @notice Gas/complexity tests from test-plan.md, production candidate only.
/// User-count independence is asserted hard; range-width scaling is linear by
/// design and is logged/documented rather than claimed O(1).
contract GasTest is Test {
    MockERC20 internal t0;
    MockERC20 internal t1;
    RangeTakeProfitBook internal book;

    uint128 internal constant L = 1e15;

    function _fresh(int24 startTick) internal {
        t0 = new MockERC20("T0", "T0");
        t1 = new MockERC20("T1", "T1");
        book = new RangeTakeProfitBook(address(t0), address(t1), 1, startTick);
        t1.mint(address(this), 1e30);
        t1.approve(address(book), type(uint256).max);
    }

    function _user(uint256 i) internal returns (address u) {
        u = makeAddr(string(abi.encodePacked("user", vm.toString(i))));
        t0.mint(u, 1e30);
        vm.prank(u);
        t0.approve(address(book), type(uint256).max);
    }

    function _seedUsers(uint256 n, int24 lower, int24 upper) internal {
        for (uint256 i = 0; i < n; i++) {
            address u = _user(i);
            vm.prank(u);
            book.deposit(lower, upper, L);
        }
    }

    function _depositGas(address u, int24 lower, int24 upper) internal returns (uint256 used) {
        vm.prank(u);
        uint256 g = gasleft();
        book.deposit(lower, upper, L);
        used = g - gasleft();
    }

    // ------------------------------------------------------------------
    // testDepositGasIndependentOfUserCount
    // ------------------------------------------------------------------

    function testDepositGasIndependentOfUserCount() public {
        uint256[3] memory counts = [uint256(1), 10, 100];
        uint256[3] memory gasUsed;
        for (uint256 c = 0; c < counts.length; c++) {
            _fresh(9);
            _seedUsers(counts[c], 10, 30);
            gasUsed[c] = _depositGas(_user(999), 10, 30);
            console2.log("deposit gas with N existing users:", counts[c], gasUsed[c]);
        }
        assertApproxEqRel(gasUsed[0], gasUsed[2], 0.05e18, "deposit gas must not grow with users");
    }

    // ------------------------------------------------------------------
    // testSwapGasIndependentOfUserCount
    // ------------------------------------------------------------------

    function testSwapGasIndependentOfUserCount() public {
        uint256[3] memory counts = [uint256(1), 10, 100];
        uint256[3] memory gasUsed;
        for (uint256 c = 0; c < counts.length; c++) {
            _fresh(9);
            _seedUsers(counts[c], 10, 12);
            uint256 g = gasleft();
            book.moveTickTo(12);
            gasUsed[c] = g - gasleft();
            console2.log("swap gas with N users behind ticks:", counts[c], gasUsed[c]);
        }
        assertApproxEqRel(gasUsed[0], gasUsed[2], 0.05e18, "swap gas must not grow with users");
    }

    // ------------------------------------------------------------------
    // testClaimGasIndependentOfOtherUsers
    // ------------------------------------------------------------------

    function testClaimGasIndependentOfOtherUsers() public {
        uint256[3] memory counts = [uint256(1), 10, 100];
        uint256[3] memory gasUsed;
        for (uint256 c = 0; c < counts.length; c++) {
            _fresh(9);
            address probe = _user(999);
            vm.prank(probe);
            uint256 id = book.deposit(10, 12, L);
            _seedUsers(counts[c], 10, 12);
            book.moveTickTo(12);

            vm.prank(probe);
            uint256 g = gasleft();
            book.claim(id);
            gasUsed[c] = g - gasleft();
            console2.log("claim gas with N other users:", counts[c], gasUsed[c]);
        }
        assertApproxEqRel(gasUsed[0], gasUsed[2], 0.05e18, "claim gas must not grow with other users");
    }

    // ------------------------------------------------------------------
    // testDepositGasVsRangeWidth — linear by design; documented, not hidden
    // ------------------------------------------------------------------

    function testDepositGasVsRangeWidth() public {
        uint24[3] memory widths = [uint24(10), 100, 500];
        uint256[3] memory gasUsed;
        for (uint256 c = 0; c < widths.length; c++) {
            _fresh(9);
            gasUsed[c] = _depositGas(_user(0), 10, 10 + int24(widths[c]));
            console2.log("deposit gas at width:", widths[c], gasUsed[c]);
        }
        // Document linear scaling: 10x width => ~10x interval writes.
        assertGt(gasUsed[1], gasUsed[0], "expected width-linear deposit");
        assertGt(gasUsed[2], gasUsed[1], "expected width-linear deposit");
    }

    // ------------------------------------------------------------------
    // testClaimGasVsRangeWidth — linear by design; documented, not hidden
    // ------------------------------------------------------------------

    function testClaimGasVsRangeWidth() public {
        uint24[3] memory widths = [uint24(10), 100, 500];
        uint256[3] memory gasUsed;
        for (uint256 c = 0; c < widths.length; c++) {
            _fresh(9);
            address u = _user(0);
            vm.prank(u);
            uint256 id = book.deposit(10, 10 + int24(widths[c]), L);
            book.moveTickTo(11); // only [10,11) fills

            vm.prank(u);
            uint256 g = gasleft();
            book.claim(id);
            gasUsed[c] = g - gasleft();
            console2.log("claim gas at width:", widths[c], gasUsed[c]);
        }
        assertGt(gasUsed[1], gasUsed[0], "expected width-linear claim");
        assertGt(gasUsed[2], gasUsed[1], "expected width-linear claim");
    }

    // ------------------------------------------------------------------
    // testSwapGasScalesOnlyWithInitializedTicks
    // ------------------------------------------------------------------

    function testSwapGasScalesOnlyWithInitializedTicks() public {
        // gas grows with crossed intervals...
        uint24[3] memory crossed = [uint24(1), 10, 50];
        uint256[3] memory gasUsed;
        for (uint256 c = 0; c < crossed.length; c++) {
            _fresh(9);
            _seedUsers(1, 10, 10 + int24(crossed[c]));
            uint256 g = gasleft();
            book.moveTickTo(10 + int24(crossed[c]));
            gasUsed[c] = g - gasleft();
            console2.log("swap gas crossing intervals:", crossed[c], gasUsed[c]);
        }
        assertGt(gasUsed[2], gasUsed[1], "expected crossed-interval scaling");

        // ...but not with users behind a fixed number of crossed intervals.
        uint256[2] memory byUsers;
        uint256[2] memory userCounts = [uint256(1), 50];
        for (uint256 c = 0; c < userCounts.length; c++) {
            _fresh(9);
            _seedUsers(userCounts[c], 10, 20);
            uint256 g = gasleft();
            book.moveTickTo(20);
            byUsers[c] = g - gasleft();
            console2.log("swap gas (10 intervals) with N users:", userCounts[c], byUsers[c]);
        }
        assertApproxEqRel(byUsers[0], byUsers[1], 0.05e18, "swap gas must not grow with users");
    }

    // ------------------------------------------------------------------
    // One wide position vs many single-interval positions over the same span
    // ------------------------------------------------------------------

    function testWideVsManySinglePositions() public {
        uint24 constant_WIDTH = 100;

        // One position across [10, 110)
        _fresh(9);
        address a = _user(0);
        vm.prank(a);
        uint256 g = gasleft();
        uint256 wideId = book.deposit(10, 10 + int24(constant_WIDTH), L);
        uint256 wideDeposit = g - gasleft();

        book.moveTickTo(10 + int24(constant_WIDTH)); // fill everything
        vm.prank(a);
        g = gasleft();
        book.claim(wideId);
        uint256 wideClaim = g - gasleft();

        // 100 single-interval positions across the same span
        _fresh(9);
        address b = _user(1);
        uint256[] memory singleIds = new uint256[](constant_WIDTH);
        uint256 manyDeposit;
        for (uint24 k = 0; k < constant_WIDTH; k++) {
            vm.prank(b);
            g = gasleft();
            singleIds[k] = book.deposit(10 + int24(k), 11 + int24(k), L);
            manyDeposit += g - gasleft();
        }

        book.moveTickTo(10 + int24(constant_WIDTH));
        uint256 manyClaim;
        for (uint24 k = 0; k < constant_WIDTH; k++) {
            vm.prank(b);
            g = gasleft();
            book.claim(singleIds[k]);
            manyClaim += g - gasleft();
        }

        console2.log("deposit: 1 wide position   ", wideDeposit);
        console2.log("deposit: 100 single positions", manyDeposit);
        console2.log("claim:   1 wide position   ", wideClaim);
        console2.log("claim:   100 single positions", manyClaim);

        assertLt(wideDeposit, manyDeposit, "wide deposit must be cheaper");
        assertLt(wideClaim, manyClaim, "wide claim must be cheaper");
    }

    // ------------------------------------------------------------------
    // testHistoricalFragmentationCanary — claims must not scan history
    // ------------------------------------------------------------------

    function testHistoricalFragmentationCanary() public {
        uint256[2] memory lifecycles = [uint256(2), 40];
        uint256[2] memory gasUsed;
        for (uint256 c = 0; c < lifecycles.length; c++) {
            _fresh(9);
            // Fragment history: many fill/reversal lifecycles on [10,11).
            address churner = _user(1);
            for (uint256 k = 0; k < lifecycles[c]; k++) {
                vm.prank(churner);
                book.deposit(10, 11, L);
                book.moveTickTo(11);
                book.moveTickTo(9);
            }
            // Broad position after fragmentation, then a fill and a claim.
            address probe = _user(999);
            vm.prank(probe);
            uint256 id = book.deposit(10, 50, L);
            book.moveTickTo(11);

            vm.prank(probe);
            uint256 g = gasleft();
            book.claim(id);
            gasUsed[c] = g - gasleft();
            console2.log("claim gas after K lifecycles:", lifecycles[c], gasUsed[c]);
        }
        assertApproxEqRel(gasUsed[0], gasUsed[1], 0.05e18, "claim gas must not grow with history");
    }
}
