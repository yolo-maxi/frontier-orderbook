// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test, console2} from "forge-std/Test.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {Hooks} from "v4-core/libraries/Hooks.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {PoolIdLibrary} from "v4-core/types/PoolId.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {TickMath} from "v4-core/libraries/TickMath.sol";
import {SqrtPriceMath} from "v4-core/libraries/SqrtPriceMath.sol";
import {StateLibrary} from "v4-core/libraries/StateLibrary.sol";

import {RangeTakeProfitHook} from "../src/RangeTakeProfitHook.sol";

interface IUniversalRouter {
    function execute(bytes calldata commands, bytes[] calldata inputs, uint256 deadline) external payable;
}

interface IPermit2 {
    function approve(address token, address spender, uint160 amount, uint48 expiration) external;
}

interface IERC20 {
    function approve(address spender, uint256 amount) external returns (bool);
    function balanceOf(address owner) external view returns (uint256);
}

/// @notice End-to-end test on a Base mainnet fork: the hook on the REAL
/// deployed PoolManager, real WETH/USDC, fills driven by the REAL Universal
/// Router (V4_SWAP via Permit2), exactly as a production swapper would.
///
/// Gated behind FORK=true so the default `forge test` run stays offline:
///   FORK=true forge test --match-contract ForkBaseHookTest -vv
contract ForkBaseHookTest is Test {
    using StateLibrary for IPoolManager;
    using PoolIdLibrary for PoolKey;

    // Base mainnet deployments
    IPoolManager constant PM = IPoolManager(0x498581fF718922c3f8e6A244956aF099B2652b2b);
    address constant UNIVERSAL_ROUTER = 0xFdf682F51FE81Aa4898F0AE2163d8A55c127fbC7; // UR 2.1.1
    address constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    address constant WETH = 0x4200000000000000000000000000000000000006; // currency0 (lower address)
    address constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913; // currency1

    uint256 constant FORK_BLOCK = 47138448;

    // Universal Router / v4-periphery encoding constants (verified against
    // the deployed router's source on Sourcify)
    uint8 constant CMD_V4_SWAP = 0x10;
    uint8 constant ACTION_SWAP_EXACT_IN_SINGLE = 0x06;
    uint8 constant ACTION_SETTLE_ALL = 0x0c;
    uint8 constant ACTION_TAKE_ALL = 0x0f;

    /// @dev Must match IV4Router.ExactInputSingleParams of the DEPLOYED
    /// UR 2.1.1 (6 fields incl. minHopPriceX36; 0 disables the check).
    struct ExactInputSingleParams {
        PoolKey poolKey;
        bool zeroForOne;
        uint128 amountIn;
        uint128 amountOutMinimum;
        uint256 minHopPriceX36;
        bytes hookData;
    }

    // Pool: fresh WETH/USDC fee-0 pool with our hook, priced ~2520 USDC/WETH
    int24 constant SPACING = 10;
    int24 constant START = -198000;
    int24 constant T1 = -197990; // bob's intervals: [T1,T1+10) .. 4 of them
    uint128 constant L = 1e16; // ~0.1 WETH / ~251 USDC per interval

    RangeTakeProfitHook hook;
    PoolKey key;
    address bob;
    address carol;
    address swapper;
    bool runFork;

    function setUp() public {
        runFork = vm.envOr("FORK", false);
        if (!runFork) return;

        string memory rpc = vm.envOr(
            "BASE_RPC_URL", string("https://rpc-endpoints.superfluid.dev/base-mainnet?app=streme-x8fsj6")
        );
        vm.createSelectFork(rpc, FORK_BLOCK);

        // deploy the hook at a flag-encoded address on the fork
        uint160 flags = uint160(Hooks.AFTER_INITIALIZE_FLAG | Hooks.AFTER_SWAP_FLAG);
        address hookAddr = address((uint160(0xF0F0) << 20) | flags);
        deployCodeTo("RangeTakeProfitHook.sol:RangeTakeProfitHook", abi.encode(PM), hookAddr);
        hook = RangeTakeProfitHook(hookAddr);

        key = PoolKey({
            currency0: Currency.wrap(WETH),
            currency1: Currency.wrap(USDC),
            fee: 0,
            tickSpacing: SPACING,
            hooks: IHooks(hookAddr)
        });
        PM.initialize(key, TickMath.getSqrtPriceAtTick(START));

        // order placers hold real WETH
        bob = makeAddr("bob");
        carol = makeAddr("carol");
        deal(WETH, bob, 1 ether);
        deal(WETH, carol, 1 ether);
        vm.prank(bob);
        IERC20(WETH).approve(hookAddr, type(uint256).max);
        vm.prank(carol);
        IERC20(WETH).approve(hookAddr, type(uint256).max);

        // the swapper buys WETH with real USDC through the Universal Router
        swapper = makeAddr("swapper");
        deal(USDC, swapper, 10_000e6);
        vm.startPrank(swapper);
        IERC20(USDC).approve(PERMIT2, type(uint256).max);
        IPermit2(PERMIT2).approve(USDC, UNIVERSAL_ROUTER, type(uint160).max, type(uint48).max);
        vm.stopPrank();
    }

    function _at(int24 tick) internal pure returns (uint160) {
        return TickMath.getSqrtPriceAtTick(tick);
    }

    function _amt1(int24 lower) internal pure returns (uint256) {
        return SqrtPriceMath.getAmount1Delta(_at(lower), _at(lower + SPACING), L, false);
    }

    function _amt0(int24 lower) internal pure returns (uint256) {
        return SqrtPriceMath.getAmount0Delta(_at(lower), _at(lower + SPACING), L, false);
    }

    /// @dev USDC needed to sweep [fromLower, toUpper) of bucket liquidity L
    /// (per-step round-up, matching the pool's swap math at fee 0).
    function _sweepCost(int24 fromLower, int24 toUpper) internal pure returns (uint256 cost) {
        for (int24 t = fromLower; t < toUpper; t += SPACING) {
            cost += SqrtPriceMath.getAmount1Delta(_at(t), _at(t + SPACING), L, true);
        }
    }

    /// @dev Real-router fill: exact-input USDC -> WETH through UR's V4_SWAP.
    function _swapViaUniversalRouter(uint256 amountIn) internal {
        bytes memory actions =
            abi.encodePacked(ACTION_SWAP_EXACT_IN_SINGLE, ACTION_SETTLE_ALL, ACTION_TAKE_ALL);
        bytes[] memory params = new bytes[](3);
        params[0] = abi.encode(
            ExactInputSingleParams({
                poolKey: key,
                zeroForOne: false, // USDC in, WETH out: price (USDC per WETH) rises
                amountIn: uint128(amountIn),
                amountOutMinimum: 0,
                minHopPriceX36: 0,
                hookData: ""
            })
        );
        params[1] = abi.encode(key.currency1, amountIn); // SETTLE_ALL input
        params[2] = abi.encode(key.currency0, uint256(0)); // TAKE_ALL output

        bytes[] memory inputs = new bytes[](1);
        inputs[0] = abi.encode(actions, params);

        vm.prank(swapper);
        IUniversalRouter(UNIVERSAL_ROUTER).execute(
            abi.encodePacked(CMD_V4_SWAP), inputs, block.timestamp + 3600
        );
    }

    function _tick() internal view returns (int24 tick) {
        (, tick,,) = PM.getSlot0(key.toId());
    }

    function testFork_EndToEndOnBase() public {
        vm.skip(!runFork);

        // ---- 1. Bob places a 4-interval WETH take-profit ladder ----
        uint256 bobWethBefore = IERC20(WETH).balanceOf(bob);
        vm.prank(bob);
        uint256 bobId = hook.deposit(T1, T1 + 4 * SPACING, L);
        uint256 deposited = bobWethBefore - IERC20(WETH).balanceOf(bob);
        // pool rounds each interval's amount0 up; view formula rounds down
        assertApproxEqAbs(deposited, hook.unfilledPrincipal(bobId), 4, "real WETH pulled = principal");
        console2.log("bob deposited WETH:", deposited);

        // ---- 2. Real Universal Router swap sweeps the first 2 intervals ----
        uint256 cost = _sweepCost(T1, T1 + 2 * SPACING);
        uint256 swapperWethBefore = IERC20(WETH).balanceOf(swapper);
        _swapViaUniversalRouter(cost);
        console2.log("UR swap paid USDC:", cost);

        assertEq(_tick(), T1 + 2 * SPACING, "price landed on boundary");
        assertEq(hook.activeLiquidity(T1), 0, "bucket 1 consumed");
        assertEq(hook.activeLiquidity(T1 + SPACING), 0, "bucket 2 consumed");
        assertEq(hook.activeLiquidity(T1 + 2 * SPACING), L, "bucket 3 live");
        assertEq(hook.activeLiquidity(T1 + 3 * SPACING), L, "bucket 4 live");
        assertGt(IERC20(WETH).balanceOf(swapper) - swapperWethBefore, 0, "swapper got real WETH");

        uint256 expected2Fills = _amt1(T1) + _amt1(T1 + SPACING);
        assertEq(hook.claimable(bobId), expected2Fills, "bob claimable = 2 fills");

        // ---- 3. Reversal: price all the way back down; nothing resurrects ----
        hook.moveTickTo(START);
        assertEq(_tick(), START, "price reversed");
        assertEq(hook.activeLiquidity(T1), 0, "no resurrection");
        assertEq(hook.claimable(bobId), expected2Fills, "claimable unchanged");

        // ---- 4. Carol joins the consumed intervals; second sweep is hers ----
        vm.prank(carol);
        uint256 carolId = hook.deposit(T1, T1 + 2 * SPACING, L);
        assertEq(hook.claimable(carolId), 0, "carol inherits nothing");

        _swapViaUniversalRouter(_sweepCost(T1, T1 + 2 * SPACING));
        assertEq(_tick(), T1 + 2 * SPACING, "second sweep landed");
        assertEq(hook.claimable(carolId), expected2Fills, "second fill is carol's");
        assertEq(hook.claimable(bobId), expected2Fills, "bob unchanged: epoch isolation");

        // ---- 5. Claims pay real USDC, exactly once ----
        vm.prank(bob);
        uint256 bobPaid = hook.claim(bobId);
        assertEq(bobPaid, expected2Fills, "bob paid");
        assertEq(IERC20(USDC).balanceOf(bob), expected2Fills, "bob holds real USDC");
        vm.prank(bob);
        assertEq(hook.claim(bobId), 0, "no double claim");

        vm.prank(carol);
        hook.claim(carolId);
        assertEq(IERC20(USDC).balanceOf(carol), expected2Fills, "carol holds real USDC");

        // ---- 6. Bob cancels: unfilled WETH principal comes back ----
        uint256 bobWethPreCancel = IERC20(WETH).balanceOf(bob);
        vm.prank(bob);
        (uint256 cancelProceeds, uint256 principal0) = hook.cancel(bobId);
        assertEq(cancelProceeds, 0, "everything already claimed");
        assertEq(principal0, _amt0(T1 + 2 * SPACING) + _amt0(T1 + 3 * SPACING), "principal = intervals 3+4");
        assertEq(IERC20(WETH).balanceOf(bob) - bobWethPreCancel, principal0, "real WETH returned");
        assertEq(hook.activeLiquidity(T1 + 2 * SPACING), 0, "bucket 3 withdrawn");
        assertEq(hook.activeLiquidity(T1 + 3 * SPACING), 0, "bucket 4 withdrawn");
        console2.log("bob USDC proceeds:", expected2Fills, "WETH returned:", principal0);
    }

    function testFork_DepositBelowPriceReverts() public {
        vm.skip(!runFork);
        vm.prank(bob);
        vm.expectRevert(bytes("range not above price"));
        hook.deposit(START - 100, START, L);
    }
}
