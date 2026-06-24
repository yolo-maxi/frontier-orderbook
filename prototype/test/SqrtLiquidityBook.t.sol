// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {MockERC20} from "../src/MockERC20.sol";
import {SqrtLiquidityBook} from "../src/sqrt/SqrtLiquidityBook.sol";
import {GeoTickMath} from "../src/curve/GeoTickMath.sol";

/// @notice The L-sized book in motion: makers provide L (never a token amount),
/// the escrow token is derived, fills convert at the range price, and an ask is
/// a bid reflected.
contract SqrtLiquidityBookTest is Test {
    MockERC20 t0;
    MockERC20 t1;
    SqrtLiquidityBook book;
    address maker = makeAddr("maker");
    address taker = makeAddr("taker");
    uint128 constant L = 1e18;

    function setUp() public {
        t0 = new MockERC20("T0", "T0");
        t1 = new MockERC20("T1", "T1");
        book = new SqrtLiquidityBook(address(t0), address(t1), 1);
        address[2] memory who = [maker, taker];
        for (uint256 i = 0; i < 2; i++) {
            t0.mint(who[i], 1e30);
            t1.mint(who[i], 1e30);
            vm.startPrank(who[i]);
            t0.approve(address(book), type(uint256).max);
            t1.approve(address(book), type(uint256).max);
            vm.stopPrank();
        }
    }

    function testProvideAskSizedInLThenTake() public {
        // maker provides L over [1000,1010) — escrows token0, never names an amount
        uint256 quoted0 = book.quoteAsk(1000, 1010, L);
        uint256 m0Before = t0.balanceOf(maker);
        vm.prank(maker);
        uint256 id = book.provideAsk(1000, 1010, L);
        assertEq(m0Before - t0.balanceOf(maker), quoted0, "escrowed the derived token0 leg");

        // taker hits it: pays token1, receives the token0; tokens conserved
        uint256 mk1Before = t1.balanceOf(maker);
        uint256 tk0Before = t0.balanceOf(taker);
        vm.prank(taker);
        (uint256 paid1, uint256 got0) = book.takeAsk(id);
        assertEq(t1.balanceOf(maker) - mk1Before, paid1, "maker received token1");
        assertEq(t0.balanceOf(taker) - tk0Before, got0, "taker received token0");
        assertEq(got0, quoted0, "taker got exactly the escrow");

        // realized price sits inside [P(lower), P(upper)] — exact, no thinness needed
        uint256 realized = paid1 * 1e18 / got0;
        assertGe(realized, GeoTickMath.powX18(1000), "price >= P(lower)");
        assertLe(realized, GeoTickMath.powX18(1010), "price <= P(upper)");
    }

    function testProvideBidIsAskWithTheLegSwapped() public {
        // same L, same call shape — only the escrow leg differs
        uint256 quoted1 = book.quoteBid(1000, 1010, L);
        uint256 m1Before = t1.balanceOf(maker);
        vm.prank(maker);
        uint256 id = book.provideBid(1000, 1010, L);
        assertEq(m1Before - t1.balanceOf(maker), quoted1, "escrowed the token1 leg");

        vm.prank(taker);
        (uint256 paid0, uint256 got1) = book.takeBid(id);
        assertEq(got1, quoted1, "taker got the token1 escrow");
        uint256 realized = got1 * 1e18 / paid0;
        assertGe(realized, GeoTickMath.powX18(1000), "price >= P(lower)");
        assertLe(realized, GeoTickMath.powX18(1010), "price <= P(upper)");
    }

    // The symmetry at the book surface: the token0 an ask of L needs over [a,b)
    // equals the token1 a bid of L needs over the reflected range [-b+s,-a+s).
    function testAskBidReflectionSymmetry() public view {
        uint256 ask0 = book.quoteAsk(1000, 1010, L);
        uint256 bid1Mirror = book.quoteBid(-1009, -999, L);
        assertApproxEqRel(ask0, bid1Mirror, 1e9, "ask leg == reflected bid leg");
    }

    function testCancelRefundsEscrow() public {
        uint256 before = t0.balanceOf(maker);
        vm.prank(maker);
        uint256 id = book.provideAsk(2000, 2050, L);
        vm.prank(maker);
        uint256 refunded = book.cancel(id);
        assertEq(t0.balanceOf(maker), before, "fully refunded");
        assertGt(refunded, 0, "non-zero escrow");
    }
}
