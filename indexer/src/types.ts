import type { Address, Hex } from "viem";

/** A decoded log the ingest layer can apply, regardless of source. */
export interface DecodedEvent {
  source: "book" | "factory" | "nft";
  eventName: string;
  /** Address that emitted the log (book / factory / nft wrapper), lowercased. */
  address: Address;
  args: Record<string, unknown>;
  blockNumber: bigint;
  logIndex: number;
  transactionHash: Hex;
  /** Block timestamp in seconds, if known. */
  timestamp?: number;
}

export interface MarketRow {
  address: string;
  token0: string;
  token1: string;
  tickSpacing: number;
  startTick: number | null;
  creator: string | null;
  hooks: string | null;
  feeRecipient: string | null;
  makerFeeBps: number;
  takerFeeBps: number;
  currentTick: number | null;
  createdBlock: number | null;
  nftWrapper: string | null;
}

export interface EventEmitter {
  emit(channel: string, payload: unknown): void;
}
