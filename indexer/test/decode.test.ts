import { describe, it, expect } from "vitest";
import { encodeEventTopics, encodeAbiParameters, getAbiItem, type Log } from "viem";
import { bookEventsAbi } from "../src/abi.js";
import { decodeLogs } from "../src/indexer/decode.js";

// Build a raw on-chain-shaped log for the Deposit event, then prove the
// decoder reconstructs the args. This exercises the real viem parse path the
// live indexer uses (not just hand-built DecodedEvents).
function makeDepositLog(): Log {
  const item = getAbiItem({ abi: bookEventsAbi, name: "Deposit" });
  const topics = encodeEventTopics({
    abi: bookEventsAbi,
    eventName: "Deposit",
    args: { positionId: 42n, owner: "0x000000000000000000000000000000000000a11c" },
  });
  // non-indexed: lower (int24), upper (int24), liquidity (uint128)
  const nonIndexed = (item as any).inputs.filter((i: any) => !i.indexed);
  const data = encodeAbiParameters(nonIndexed, [100, 140, 1_000_000_000_000_000_000n]);
  return {
    address: "0x00000000000000000000000000000000000000b0",
    topics: topics as any,
    data,
    blockNumber: 7n,
    blockHash: "0x" + "0".repeat(64),
    logIndex: 3,
    transactionHash: ("0x" + "1".repeat(64)) as `0x${string}`,
    transactionIndex: 0,
    removed: false,
  } as Log;
}

describe("log decoding (real viem parse path)", () => {
  it("decodes a raw Deposit log into a DecodedEvent", () => {
    const decoded = decodeLogs("book", [makeDepositLog()]);
    expect(decoded).toHaveLength(1);
    const ev = decoded[0]!;
    expect(ev.eventName).toBe("Deposit");
    expect(ev.args.positionId).toBe(42n);
    expect(ev.args.lower).toBe(100);
    expect(ev.args.upper).toBe(140);
    expect(ev.args.liquidity).toBe(1_000_000_000_000_000_000n);
    expect(ev.blockNumber).toBe(7n);
    expect(ev.logIndex).toBe(3);
  });

  it("drops logs that do not match the ABI", () => {
    const junk = {
      address: "0x00000000000000000000000000000000000000b0",
      topics: ["0x" + "9".repeat(64)],
      data: "0x",
      blockNumber: 1n,
      blockHash: "0x" + "0".repeat(64),
      logIndex: 0,
      transactionHash: ("0x" + "2".repeat(64)) as `0x${string}`,
      transactionIndex: 0,
      removed: false,
    } as unknown as Log;
    expect(decodeLogs("book", [junk])).toHaveLength(0);
  });
});
