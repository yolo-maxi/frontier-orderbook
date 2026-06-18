// Decode raw viem logs into the transport-agnostic DecodedEvent shape that
// the ingest layer consumes. Logs that do not match a known event are dropped.

import { parseEventLogs, type Log } from "viem";
import { bookEventsAbi, factoryEventsAbi, positionNftEventsAbi } from "../abi.js";
import type { DecodedEvent } from "../types.js";

const ABIS = {
  book: bookEventsAbi,
  factory: factoryEventsAbi,
  nft: positionNftEventsAbi,
} as const;

export type Source = keyof typeof ABIS;

/**
 * Decode a batch of logs from a single source. `timestamps` maps blockNumber
 * (as string) -> unix seconds; optional.
 */
export function decodeLogs(
  source: Source,
  logs: Log[],
  timestamps?: Map<string, number>,
): DecodedEvent[] {
  const parsed = parseEventLogs({ abi: ABIS[source], logs, strict: false });
  const out: DecodedEvent[] = [];
  for (const p of parsed) {
    if (p.blockNumber === null || p.logIndex === null || p.transactionHash === null) continue;
    out.push({
      source,
      eventName: p.eventName,
      address: p.address.toLowerCase() as `0x${string}`,
      args: p.args as Record<string, unknown>,
      blockNumber: p.blockNumber,
      logIndex: p.logIndex,
      transactionHash: p.transactionHash,
      timestamp: timestamps?.get(p.blockNumber.toString()),
    });
  }
  return out;
}
