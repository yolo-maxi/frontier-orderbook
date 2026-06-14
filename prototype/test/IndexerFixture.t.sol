// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, Vm} from "forge-std/Test.sol";
import {MockERC20} from "../src/MockERC20.sol";
import {GeometricFrontierBook} from "../src/GeometricFrontierBook.sol";
import {FrontierGeoBookFactory} from "../src/FrontierGeoBookFactory.sol";
import {GeometricBookDeployer, GeometricOpsDeployer} from "../src/FrontierDeployers.sol";

/// @notice Fixture generator for the standalone indexer attempt.
///
/// This is NOT a normal unit test: it drives a realistic multi-actor scenario
/// against the *deployed* GeometricFrontierBook (created via the production
/// FrontierGeoBookFactory), records every emitted log with vm.recordLogs, and
/// serializes them in the exact shape `eth_getLogs` returns (address, topics,
/// data, blockNumber, logIndex) into indexer/fixtures/. It also writes a
/// ground-truth file with the values an off-chain indexer would WANT to
/// recover (sides, takers, per-trade amounts, token of each payout) so the TS
/// indexer can reconcile what the event surface actually supports.
///
/// Two fixtures are produced: zero-fee (the default deploy) and fee-enabled.
contract IndexerFixtureGen is Test {
    // actors
    address internal makerA = makeAddr("makerA");
    address internal makerB = makeAddr("makerB");
    address internal makerC = makeAddr("makerC");
    address internal makerD = makeAddr("makerD");
    address internal taker = makeAddr("taker");
    address internal taker2 = makeAddr("taker2");
    address internal recipient = makeAddr("feeRecipient");
    address internal newOwner = makeAddr("newOwner");

    uint128 internal constant L = 1e18;

    function test_gen_zero_fee_fixture() public {
        _run("scenario-nofee", 0, 0);
    }

    function test_gen_fee_fixture() public {
        _run("scenario-fee", 30, 10); // makerFeeBps=30, takerFeeBps=10
    }

    function _run(string memory name, uint16 makerFeeBps, uint16 takerFeeBps) internal {
        MockERC20 t0 = new MockERC20("T0", "T0");
        MockERC20 t1 = new MockERC20("T1", "T1");
        address feeRecipient = (makerFeeBps == 0 && takerFeeBps == 0) ? address(0) : recipient;

        FrontierGeoBookFactory factory =
            new FrontierGeoBookFactory(address(0), new GeometricBookDeployer(), new GeometricOpsDeployer());

        // fund + approve everyone
        address[6] memory all = [makerA, makerB, makerC, makerD, taker, taker2];
        for (uint256 i = 0; i < all.length; i++) {
            t0.mint(all[i], 1e30);
            t1.mint(all[i], 1e30);
        }

        // JSON accumulators
        string memory logs = "[";
        uint256 idx = 0;
        bool first = true;

        // ---- block 1: create book ----
        vm.roll(1);
        vm.recordLogs();
        vm.prank(makerA);
        address bookAddr =
            factory.createGeoBookWithFees(address(t0), address(t1), 1, 0, feeRecipient, makerFeeBps, takerFeeBps);
        GeometricFrontierBook book = GeometricFrontierBook(bookAddr);
        (logs, idx, first) = _drain(logs, 1, idx, first);

        for (uint256 i = 0; i < all.length; i++) {
            vm.startPrank(all[i]);
            t0.approve(bookAddr, type(uint256).max);
            t1.approve(bookAddr, type(uint256).max);
            vm.stopPrank();
        }
        vm.getRecordedLogs(); // discard approval logs (ERC20 Transfer/Approval not from book)

        // ---- block 2: makerA ask deposit [0,10) ----
        vm.roll(2);
        vm.recordLogs();
        vm.prank(makerA);
        uint256 pos1 = book.deposit(1, 11, L);
        (logs, idx, first) = _drainBookOnly(logs, 2, idx, first, bookAddr);

        // ---- block 3: makerB ask deposit [5,15) L=2 ----
        vm.roll(3);
        vm.recordLogs();
        vm.prank(makerB);
        uint256 pos2 = book.deposit(5, 15, 2 * L);
        (logs, idx, first) = _drainBookOnly(logs, 3, idx, first, bookAddr);

        // ---- block 4: makerC bid deposit [-10,0) ----
        vm.roll(4);
        vm.recordLogs();
        vm.prank(makerC);
        uint256 pos3 = book.depositBid(-10, 0, L);
        (logs, idx, first) = _drainBookOnly(logs, 4, idx, first, bookAddr);

        // ---- block 5: taker UP-sweep to tick 8 (buys token0, pays token1) ----
        vm.roll(5);
        vm.recordLogs();
        vm.prank(taker);
        (, uint256 upPaid, uint256 upRecv) = book.sweepWithLimits(8, type(uint256).max, type(uint256).max, 0, block.timestamp);
        (logs, idx, first) = _drainBookOnly(logs, 5, idx, first, bookAddr);

        // ---- block 6: makerA claim (ask -> token1 proceeds) ----
        vm.roll(6);
        vm.recordLogs();
        vm.prank(makerA);
        uint256 claimA = book.claim(pos1);
        (logs, idx, first) = _drainBookOnly(logs, 6, idx, first, bookAddr);

        // ---- block 7: taker2 DOWN-sweep to tick -5 (sells token0, receives token1) ----
        vm.roll(7);
        vm.recordLogs();
        vm.prank(taker2);
        (, uint256 dnPaid, uint256 dnRecv) = book.sweepWithLimits(-5, type(uint256).max, type(uint256).max, 0, block.timestamp);
        (logs, idx, first) = _drainBookOnly(logs, 7, idx, first, bookAddr);

        // ---- block 8: makerC claimBid (bid -> token0 proceeds) ----
        vm.roll(8);
        vm.recordLogs();
        vm.prank(makerC);
        uint256 claimC = book.claimBid(pos3);
        (logs, idx, first) = _drainBookOnly(logs, 8, idx, first, bookAddr);

        // ---- block 9: makerD ask deposit [100,110) (stays unfilled) ----
        vm.roll(9);
        vm.recordLogs();
        vm.prank(makerD);
        uint256 pos4 = book.deposit(100, 110, L);
        (logs, idx, first) = _drainBookOnly(logs, 9, idx, first, bookAddr);

        // ---- block 10: makerD requote pos4 -> [200,210) ----
        vm.roll(10);
        vm.recordLogs();
        vm.prank(makerD);
        book.requote(pos4, 200, 210, L);
        (logs, idx, first) = _drainBookOnly(logs, 10, idx, first, bookAddr);

        // ---- block 11: makerB cancel (partially filled ask) ----
        vm.roll(11);
        vm.recordLogs();
        vm.prank(makerB);
        (uint256 cancelProceeds, uint256 cancelPrincipal) = book.cancel(pos2);
        (logs, idx, first) = _drainBookOnly(logs, 11, idx, first, bookAddr);

        // ---- block 12: makerD transfer pos4 -> newOwner ----
        vm.roll(12);
        vm.recordLogs();
        vm.prank(makerD);
        book.transferPosition(pos4, newOwner);
        (logs, idx, first) = _drainBookOnly(logs, 12, idx, first, bookAddr);

        logs = string.concat(logs, "\n]\n");

        string memory dir = string.concat("indexer/fixtures/");
        vm.writeFile(string.concat(dir, name, ".logs.json"), logs);

        // ---- end-of-scenario position progress (for the indexer to match) ----
        // pos1 is a still-live ask filled to tick 8; pos3 a still-live bid
        // filled down to tick -5. These views are what an indexer wants to
        // reconstruct from events alone.
        uint256[4] memory prog =
            [book.unfilledPrincipal(pos1), book.claimable(pos1), book.bidRefundable(pos3), book.bidClaimable(pos3)];

        // ---- ground truth ----
        string memory gt = _groundTruth(
            bookAddr,
            address(t0),
            address(t1),
            makerFeeBps,
            takerFeeBps,
            feeRecipient,
            [pos1, pos2, pos3, pos4],
            [upPaid, upRecv, dnPaid, dnRecv, claimA, claimC, cancelProceeds, cancelPrincipal],
            prog
        );
        vm.writeFile(string.concat(dir, name, ".truth.json"), gt);
    }

    // ------------------------------------------------------------------
    // log -> JSON serialization (eth_getLogs shape)
    // ------------------------------------------------------------------

    function _drain(string memory acc, uint256 blockNum, uint256 idx, bool first)
        internal
        returns (string memory, uint256, bool)
    {
        Vm.Log[] memory entries = vm.getRecordedLogs();
        return _appendLogs(acc, entries, blockNum, idx, first, address(0));
    }

    function _drainBookOnly(string memory acc, uint256 blockNum, uint256 idx, bool first, address only)
        internal
        returns (string memory, uint256, bool)
    {
        Vm.Log[] memory entries = vm.getRecordedLogs();
        return _appendLogs(acc, entries, blockNum, idx, first, only);
    }

    function _appendLogs(
        string memory acc,
        Vm.Log[] memory entries,
        uint256 blockNum,
        uint256 idx,
        bool first,
        address only
    ) internal pure returns (string memory, uint256, bool) {
        for (uint256 i = 0; i < entries.length; i++) {
            if (only != address(0) && entries[i].emitter != only) continue;
            acc = string.concat(acc, first ? "\n  " : ",\n  ", _logToJson(entries[i], blockNum, idx));
            idx++;
            first = false;
        }
        return (acc, idx, first);
    }

    function _logToJson(Vm.Log memory e, uint256 blockNum, uint256 idx) internal pure returns (string memory) {
        string memory topics = "[";
        for (uint256 j = 0; j < e.topics.length; j++) {
            topics = string.concat(topics, j == 0 ? "\"" : ",\"", vm.toString(e.topics[j]), "\"");
        }
        topics = string.concat(topics, "]");
        return string.concat(
            "{\"address\":\"",
            vm.toString(e.emitter),
            "\",\"blockNumber\":",
            vm.toString(blockNum),
            ",\"logIndex\":",
            vm.toString(idx),
            ",\"topics\":",
            topics,
            ",\"data\":\"",
            vm.toString(e.data),
            "\"}"
        );
    }

    function _groundTruth(
        address book,
        address t0,
        address t1,
        uint16 makerFeeBps,
        uint16 takerFeeBps,
        address feeRecipient,
        uint256[4] memory pos,
        uint256[8] memory amts,
        uint256[4] memory prog
    ) internal view returns (string memory) {
        // amts: [upPaid, upRecv, dnPaid, dnRecv, claimA, claimC, cancelProceeds, cancelPrincipal]
        // prog: [pos1.unfilledPrincipal, pos1.claimable, pos3.bidRefundable, pos3.bidClaimable]
        // Built in steps to stay within via-ir's stack budget.
        string memory s = string.concat(
            "{\n",
            "  \"book\": \"", vm.toString(book), "\",\n",
            "  \"token0\": \"", vm.toString(t0), "\",\n",
            "  \"token1\": \"", vm.toString(t1), "\",\n",
            "  \"makerFeeBps\": ", vm.toString(uint256(makerFeeBps)), ",\n",
            "  \"takerFeeBps\": ", vm.toString(uint256(takerFeeBps)), ",\n",
            "  \"feeRecipient\": \"", vm.toString(feeRecipient), "\",\n"
        );
        s = string.concat(
            s,
            "  \"positions\": {\n",
            "    \"", vm.toString(pos[0]), "\": {\"owner\":\"", vm.toString(makerA), "\",\"isBid\":false,\"lower\":1,\"upper\":11,\"liquidity\":\"", vm.toString(uint256(L)), "\"},\n",
            "    \"", vm.toString(pos[1]), "\": {\"owner\":\"", vm.toString(makerB), "\",\"isBid\":false,\"lower\":5,\"upper\":15,\"liquidity\":\"", vm.toString(uint256(2 * L)), "\"},\n",
            "    \"", vm.toString(pos[2]), "\": {\"owner\":\"", vm.toString(makerC), "\",\"isBid\":true,\"lower\":-10,\"upper\":0,\"liquidity\":\"", vm.toString(uint256(L)), "\"},\n",
            "    \"", vm.toString(pos[3]), "\": {\"owner\":\"", vm.toString(newOwner), "\",\"isBid\":false,\"lower\":200,\"upper\":210,\"liquidity\":\"", vm.toString(uint256(L)), "\",\"note\":\"requoted from [100,110), transferred from makerD\"}\n",
            "  },\n"
        );
        s = string.concat(
            s,
            "  \"trades\": {\n",
            "    \"upSweep\": {\"taker\":\"", vm.toString(taker), "\",\"direction\":\"up\",\"tokenIn\":\"token1\",\"tokenOut\":\"token0\",\"paid\":\"", vm.toString(amts[0]), "\",\"received\":\"", vm.toString(amts[1]), "\"},\n",
            "    \"downSweep\": {\"taker\":\"", vm.toString(taker2), "\",\"direction\":\"down\",\"tokenIn\":\"token0\",\"tokenOut\":\"token1\",\"paid\":\"", vm.toString(amts[2]), "\",\"received\":\"", vm.toString(amts[3]), "\"}\n",
            "  },\n"
        );
        s = string.concat(
            s,
            "  \"claims\": {\n",
            "    \"makerA_ask\": {\"token\":\"token1\",\"amount\":\"", vm.toString(amts[4]), "\"},\n",
            "    \"makerC_bid\": {\"token\":\"token0\",\"amount\":\"", vm.toString(amts[5]), "\"}\n",
            "  },\n",
            "  \"cancelB\": {\"proceedsToken\":\"token1\",\"proceeds\":\"", vm.toString(amts[6]), "\",\"principalToken\":\"token0\",\"principal\":\"", vm.toString(amts[7]), "\"},\n"
        );
        s = string.concat(
            s,
            "  \"progress\": {\n",
            "    \"pos1_ask\": {\"unfilledPrincipal0\":\"", vm.toString(prog[0]), "\",\"claimable1\":\"", vm.toString(prog[1]), "\"},\n",
            "    \"pos3_bid\": {\"refundable1\":\"", vm.toString(prog[2]), "\",\"claimable0\":\"", vm.toString(prog[3]), "\"}\n",
            "  }\n",
            "}\n"
        );
        return s;
    }
}
