// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MockERC20} from "../src/MockERC20.sol";
import {IRangeOrderBook} from "../src/IRangeOrderBook.sol";
import {RollingFrontierBook} from "../src/RollingFrontierBook.sol";
import {ReferenceBook} from "../src/ReferenceBook.sol";
import {newBook} from "./utils/BookFab.sol";

/// @notice Differential fuzz: rolling-frontier book vs the eager reference
/// oracle. Token0 flows (principal) must match EXACTLY. Token1 payouts may
/// exceed the reference by bounded wei because the frontier book floors once
/// per claimed span instead of once per interval (floor(sum) >= sum(floor)),
/// while collecting ceil per interval on the fill side — so solvency must
/// hold with margin, asserted via book residuals.
contract FrontierDifferentialTest is Test {
    int24 internal constant MAX_TICK = 60;
    uint256 internal constant ACTIONS = 40;
    // span-floor minus interval-floors is < 1 wei per filled interval
    uint256 internal constant WEI_SLACK = 1e5;

    MockERC20 internal p0;
    MockERC20 internal p1;
    MockERC20 internal r0;
    MockERC20 internal r1;
    IRangeOrderBook internal prod; // frontier book under test
    IRangeOrderBook internal ref;

    address[4] internal users;

    uint256[] internal ids;
    address[] internal owners;
    bool[] internal alive;

    uint256 internal rngState;

    function setUp() public {
        users[0] = makeAddr("u0");
        users[1] = makeAddr("u1");
        users[2] = makeAddr("u2");
        users[3] = makeAddr("u3");

        p0 = new MockERC20("P0", "P0");
        p1 = new MockERC20("P1", "P1");
        r0 = new MockERC20("R0", "R0");
        r1 = new MockERC20("R1", "R1");
        prod = IRangeOrderBook(address(newBook(address(p0), address(p1), 1, 0, address(0), address(0))));
        ref = IRangeOrderBook(address(new ReferenceBook(address(r0), address(r1), 1, 0)));

        for (uint256 i = 0; i < users.length; i++) {
            p0.mint(users[i], 1e30);
            r0.mint(users[i], 1e30);
            vm.startPrank(users[i]);
            p0.approve(address(prod), type(uint256).max);
            r0.approve(address(ref), type(uint256).max);
            vm.stopPrank();
        }
        p1.mint(address(this), 1e30);
        r1.mint(address(this), 1e30);
        p1.approve(address(prod), type(uint256).max);
        r1.approve(address(ref), type(uint256).max);
    }

    function _rand() internal returns (uint256 r) {
        rngState = uint256(keccak256(abi.encode(rngState)));
        return rngState;
    }

    function testFuzz_FrontierDifferential(uint256 seed) public {
        rngState = seed;

        for (uint256 n = 0; n < ACTIONS; n++) {
            uint256 a = _rand() % 100;
            int24 tick = prod.currentTick();

            if (a < 35 && tick < MAX_TICK - 2) {
                _doDeposit(tick);
            } else if (a < 65) {
                _doMove();
            } else if (a < 85) {
                _doClaim();
            } else {
                _doCancel();
            }

            _spotCheck();
        }

        for (uint256 i = 0; i < ids.length; i++) {
            if (alive[i]) _cancelBoth(i);
        }

        for (uint256 i = 0; i < users.length; i++) {
            assertEq(p0.balanceOf(users[i]), r0.balanceOf(users[i]), "user token0 mismatch");
            uint256 f1 = p1.balanceOf(users[i]);
            uint256 e1 = r1.balanceOf(users[i]);
            assertGe(f1, e1, "frontier must not underpay vs per-interval floors");
            assertLe(f1 - e1, WEI_SLACK, "frontier overpays beyond rounding slack");
        }
        for (int24 t = 0; t <= MAX_TICK; t++) {
            assertEq(prod.activeLiquidity(t), ref.activeLiquidity(t), "active liquidity mismatch");
            assertEq(prod.activeLiquidity(t), 0, "liquidity left after full settle");
        }
        assertEq(p0.balanceOf(address(prod)), 0, "frontier book retains principal");
        assertEq(r0.balanceOf(address(ref)), 0, "ref book retains principal");
        // ceil-collection minus span-floor payouts leaves bounded dust, never deficit
        assertLt(p1.balanceOf(address(prod)), 1e6, "frontier dust unexpectedly large");
    }

    function _doDeposit(int24 tick) internal {
        address user = users[_rand() % users.length];
        int24 lower = tick + 1 + int24(uint24(_rand() % uint24(uint24(MAX_TICK - 2 - tick))));
        int24 upper = lower + 1 + int24(uint24(_rand() % 8));
        if (upper > MAX_TICK) upper = MAX_TICK;
        if (upper <= lower) upper = lower + 1;
        uint128 liq = uint128(1 + _rand() % 1e18);

        vm.prank(user);
        uint256 idP = prod.deposit(lower, upper, liq);
        vm.prank(user);
        uint256 idR = ref.deposit(lower, upper, liq);
        assertEq(idP, idR, "position id divergence");

        ids.push(idP);
        owners.push(user);
        alive.push(true);
    }

    function _doMove() internal {
        int24 target = int24(uint24(_rand() % uint24(MAX_TICK + 1)));
        prod.moveTickTo(target);
        ref.moveTickTo(target);
    }

    function _doClaim() internal {
        uint256 i = _pickAlive();
        if (i == type(uint256).max) return;
        vm.prank(owners[i]);
        uint256 gotP = prod.claim(ids[i]);
        vm.prank(owners[i]);
        uint256 gotR = ref.claim(ids[i]);
        assertGe(gotP, gotR, "claim: frontier under reference");
        assertLe(gotP - gotR, 100, "claim: frontier too far over reference");
    }

    function _doCancel() internal {
        uint256 i = _pickAlive();
        if (i == type(uint256).max) return;
        _cancelBoth(i);
    }

    function _cancelBoth(uint256 i) internal {
        vm.prank(owners[i]);
        (uint256 c1P, uint256 c0P) = prod.cancel(ids[i]);
        vm.prank(owners[i]);
        (uint256 c1R, uint256 c0R) = ref.cancel(ids[i]);
        assertGe(c1P, c1R, "cancel proceeds: frontier under reference");
        assertLe(c1P - c1R, 100, "cancel proceeds: too far over");
        assertEq(c0P, c0R, "cancel principal mismatch");
        alive[i] = false;
    }

    function _pickAlive() internal returns (uint256) {
        if (ids.length == 0) return type(uint256).max;
        uint256 start = _rand() % ids.length;
        for (uint256 k = 0; k < ids.length; k++) {
            uint256 i = (start + k) % ids.length;
            if (alive[i]) return i;
        }
        return type(uint256).max;
    }

    /// @dev Global delta conservation: every live position contributes
    /// exactly +L (at its frontier) and -L (at its upper); rolls move the +L
    /// without changing the sum; cancels remove the pair. So the deltas must
    /// always sum to zero over the whole tick domain.
    function _assertDeltaConservation() internal view {
        RollingFrontierBook fb = RollingFrontierBook(address(prod));
        int256 sum;
        for (int24 t = 0; t <= MAX_TICK; t++) {
            sum += fb.frontierDelta(t);
        }
        assertEq(sum, 0, "frontier delta sum must be zero");
    }

    function _spotCheck() internal {
        _assertDeltaConservation();
        int24 t = int24(uint24(_rand() % uint24(MAX_TICK)));
        assertEq(prod.activeLiquidity(t), ref.activeLiquidity(t), "spot: active liquidity");

        uint256 i = _pickAlive();
        if (i != type(uint256).max) {
            uint256 cP = prod.claimable(ids[i]);
            uint256 cR = ref.claimable(ids[i]);
            assertGe(cP, cR, "spot: claimable under reference");
            assertLe(cP - cR, 100, "spot: claimable too far over");
            assertEq(prod.unfilledPrincipal(ids[i]), ref.unfilledPrincipal(ids[i]), "spot: principal");
        }
    }
}
