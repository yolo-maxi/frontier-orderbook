// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.26;

import {console2} from "forge-std/Test.sol";
import {PoolManager} from "v4-core/PoolManager.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {Hooks} from "v4-core/libraries/Hooks.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {TickMath} from "v4-core/libraries/TickMath.sol";
import {SqrtPriceMath} from "v4-core/libraries/SqrtPriceMath.sol";

import {BookTestBase} from "./BookTestBase.sol";
import {ScenarioSuite} from "./Scenarios.t.sol";
import {IRangeOrderBook} from "../src/IRangeOrderBook.sol";
import {RangeTakeProfitHook} from "../src/RangeTakeProfitHook.sol";
import {MockERC20} from "../src/MockERC20.sol";

/// @notice The full spec scenario suite, run against the REAL v4 hook on a
/// real PoolManager: fills happen via actual price-limit swaps through the
/// pool, with the hook's afterSwap burning crossed buckets. Expected amounts
/// use real sqrt-price math instead of the prototype's linear curve.
contract HookScenariosTest is ScenarioSuite {
    uint160 internal hookNonce;

    function _newBook(address token0, address token1_, int24 spacing_, int24 startTick)
        internal
        override
        returns (IRangeOrderBook)
    {
        PoolManager pm = new PoolManager(address(this));

        uint160 flags = uint160(Hooks.AFTER_INITIALIZE_FLAG | Hooks.AFTER_SWAP_FLAG);
        hookNonce++;
        address hookAddr = address((uint160(hookNonce) << 20) | flags);
        deployCodeTo("RangeTakeProfitHook.sol:RangeTakeProfitHook", abi.encode(IPoolManager(address(pm))), hookAddr);

        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(token0),
            currency1: Currency.wrap(token1_),
            fee: 0,
            tickSpacing: spacing_,
            hooks: IHooks(hookAddr)
        });
        pm.initialize(key, TickMath.getSqrtPriceAtTick(startTick));

        // the market (this test) pays for moveTickTo swaps via the swapper
        address swapper = address(RangeTakeProfitHook(hookAddr).swapper());
        MockERC20(token0).approve(swapper, type(uint256).max);
        MockERC20(token1_).approve(swapper, type(uint256).max);

        return IRangeOrderBook(hookAddr);
    }

    // Real tick math for expected amounts.

    function amt1(int24 lowerTick, uint256 liquidity) internal view override returns (uint256) {
        return SqrtPriceMath.getAmount1Delta(
            TickMath.getSqrtPriceAtTick(lowerTick),
            TickMath.getSqrtPriceAtTick(lowerTick + spacing),
            uint128(liquidity),
            false
        );
    }

    function amt0(int24 lowerTick, uint256 liquidity) internal view override returns (uint256) {
        return SqrtPriceMath.getAmount0Delta(
            TickMath.getSqrtPriceAtTick(lowerTick),
            TickMath.getSqrtPriceAtTick(lowerTick + spacing),
            uint128(liquidity),
            false
        );
    }

    // ------------------------------------------------------------------
    // Hook-specific: the S1 requirement on the real swap path
    // ------------------------------------------------------------------

    function testHookSwapGasIndependentOfUserCount() public {
        uint256[2] memory counts = [uint256(1), 25];
        uint256[2] memory gasUsed;
        for (uint256 c = 0; c < counts.length; c++) {
            _makeBook(1, 9);
            for (uint256 i = 0; i < counts[c]; i++) {
                address u = makeAddr(string(abi.encodePacked("hookuser", vm.toString(i))));
                t0.mint(u, FUND);
                vm.prank(u);
                t0.approve(address(book), type(uint256).max);
                vm.prank(u);
                book.deposit(10, 12, L);
            }
            uint256 g = gasleft();
            book.moveTickTo(12); // real swap through both buckets
            gasUsed[c] = g - gasleft();
            console2.log("hook swap gas with N users behind ticks:", counts[c], gasUsed[c]);
        }
        assertApproxEqRel(gasUsed[0], gasUsed[1], 0.05e18, "hook swap gas must not grow with users");
    }
}
