// Sample decoded events representing a small but realistic life-cycle on one
// market: a book is created, two makers deposit (one ask, one bid), a taker
// sweeps (run + interval fills + taker fee), a maker claims, another cancels,
// and a position is wrapped into a claim-token NFT then transferred.
//
// Addresses are deterministic test addresses (not the real devnet ones).

import type { DecodedEvent } from "../../src/types.js";

export const BOOK = "0x00000000000000000000000000000000000000b0";
export const FACTORY = "0x00000000000000000000000000000000000000fa";
export const NFT = "0x0000000000000000000000000000000000000fff";
export const TOKEN0 = "0x0000000000000000000000000000000000000010"; // WETH
export const TOKEN1 = "0x0000000000000000000000000000000000000011"; // USDC
export const ALICE = "0x000000000000000000000000000000000000a11c";
export const BOB = "0x0000000000000000000000000000000000000b0b";
export const CAROL = "0x000000000000000000000000000000000000ca01";
export const TAKER = "0x0000000000000000000000000000000000007a4e";

const TX = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as `0x${string}`;

export const sampleEvents: DecodedEvent[] = [
  {
    source: "factory",
    eventName: "BookCreated",
    address: FACTORY as `0x${string}`,
    args: {
      book: BOOK,
      token0: TOKEN0,
      token1: TOKEN1,
      tickSpacing: 10n,
      startTick: 0n,
      creator: ALICE,
      hooks: "0x0000000000000000000000000000000000000000",
      feeRecipient: CAROL,
      makerFeeBps: 5n,
      takerFeeBps: 3n,
    },
    blockNumber: 100n,
    logIndex: 0,
    transactionHash: TX(1),
    timestamp: 1_700_000_000,
  },
  // Alice deposits an ask ladder [100,140), 1e18 per level
  {
    source: "book",
    eventName: "Deposit",
    address: BOOK as `0x${string}`,
    args: { positionId: 1n, owner: ALICE, lower: 100n, upper: 140n, liquidity: 1_000_000_000_000_000_000n },
    blockNumber: 101n,
    logIndex: 0,
    transactionHash: TX(2),
    timestamp: 1_700_000_010,
  },
  // Bob deposits a bid ladder [-50,-10), 2e18 per level
  {
    source: "book",
    eventName: "Deposit",
    address: BOOK as `0x${string}`,
    args: { positionId: 2n, owner: BOB, lower: -50n, upper: -10n, liquidity: 2_000_000_000_000_000_000n },
    blockNumber: 102n,
    logIndex: 0,
    transactionHash: TX(3),
    timestamp: 1_700_000_020,
  },
  // Taker buys: a run fill across Alice's ladder + an interval fill + taker fee
  {
    source: "book",
    eventName: "RunFilled",
    address: BOOK as `0x${string}`,
    args: { fromLevel: 100n, toBoundary: 130n, startSize: 1_000_000_000_000_000_000n, slopePerLevel: 0n, clock: 1n },
    blockNumber: 103n,
    logIndex: 0,
    transactionHash: TX(4),
    timestamp: 1_700_000_030,
  },
  {
    source: "book",
    eventName: "IntervalFilled",
    address: BOOK as `0x${string}`,
    args: { lowerTick: 130n, liquidity: 1_000_000_000_000_000_000n, proceeds1: 3_300_000n, clock: 1n },
    blockNumber: 103n,
    logIndex: 1,
    transactionHash: TX(4),
    timestamp: 1_700_000_030,
  },
  {
    source: "book",
    eventName: "TakerFee",
    address: BOOK as `0x${string}`,
    args: {
      payer: TAKER,
      token: TOKEN1, // paid USDC -> buying token0 (WETH)
      grossInput: 9_900_000n,
      fee: 2_970n,
      totalPaid: 9_902_970n,
      recipient: CAROL,
    },
    blockNumber: 103n,
    logIndex: 2,
    transactionHash: TX(4),
    timestamp: 1_700_000_030,
  },
  // Alice claims part of her proceeds + maker fee
  {
    source: "book",
    eventName: "MakerFee",
    address: BOOK as `0x${string}`,
    args: {
      positionId: 1n,
      token: TOKEN1,
      grossProceeds: 9_900_000n,
      fee: 4_950n,
      netProceeds: 9_895_050n,
      recipient: CAROL,
    },
    blockNumber: 104n,
    logIndex: 0,
    transactionHash: TX(5),
    timestamp: 1_700_000_040,
  },
  {
    source: "book",
    eventName: "Claim",
    address: BOOK as `0x${string}`,
    args: { positionId: 1n, proceeds1: 9_895_050n },
    blockNumber: 104n,
    logIndex: 1,
    transactionHash: TX(5),
    timestamp: 1_700_000_040,
  },
  // Bob cancels his bid, getting principal back
  {
    source: "book",
    eventName: "Cancel",
    address: BOOK as `0x${string}`,
    args: { positionId: 2n, proceeds1: 0n, principal0: 8_000_000_000_000_000_000n },
    blockNumber: 105n,
    logIndex: 0,
    transactionHash: TX(6),
    timestamp: 1_700_000_050,
  },
  // Alice wraps her position into a claim-token NFT (mint tokenId 7), then
  // transfers the claim token to Carol.
  {
    source: "nft",
    eventName: "Transfer",
    address: NFT as `0x${string}`,
    args: { from: "0x0000000000000000000000000000000000000000", to: ALICE, tokenId: 7n },
    blockNumber: 106n,
    logIndex: 0,
    transactionHash: TX(7),
    timestamp: 1_700_000_060,
  },
  {
    source: "nft",
    eventName: "Transfer",
    address: NFT as `0x${string}`,
    args: { from: ALICE, to: CAROL, tokenId: 7n },
    blockNumber: 107n,
    logIndex: 0,
    transactionHash: TX(8),
    timestamp: 1_700_000_070,
  },
];
