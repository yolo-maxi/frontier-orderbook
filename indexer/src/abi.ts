// Event surface of the Frontier orderbook, mirrored from
// prototype/src/FrontierBookBase.sol, FrontierGeoBookFactory.sol, and
// periphery/FrontierPositionNFT.sol. These are the only logs the indexer
// consumes; declared inline (rather than imported JSON) so the service is
// self-contained and the parse layer is type-checked against viem.

import { parseAbi } from "viem";

// ---- Book (GeometricFrontierBook / UniformFrontierBook) -------------------
export const bookEventsAbi = parseAbi([
  "event Deposit(uint256 indexed positionId, address indexed owner, int24 lower, int24 upper, uint128 liquidity)",
  "event IntervalFilled(int24 indexed lowerTick, uint128 liquidity, uint256 proceeds1, uint64 clock)",
  "event RunFilled(int24 indexed fromLevel, int24 toBoundary, uint256 startSize, int256 slopePerLevel, uint64 clock)",
  "event Claim(uint256 indexed positionId, uint256 proceeds1)",
  "event Cancel(uint256 indexed positionId, uint256 proceeds1, uint256 principal0)",
  "event Requote(uint256 indexed positionId, int24 lower, int24 upper, uint128 liquidity)",
  "event PositionTransferred(uint256 indexed positionId, address indexed from, address indexed to)",
  "event MakerFee(uint256 indexed positionId, address indexed token, uint256 grossProceeds, uint256 fee, uint256 netProceeds, address recipient)",
  "event TakerFee(address indexed payer, address indexed token, uint256 grossInput, uint256 fee, uint256 totalPaid, address recipient)",
]);

// ---- Factory (FrontierGeoBookFactory) -------------------------------------
export const factoryEventsAbi = parseAbi([
  "event BookCreated(address indexed book, address indexed token0, address indexed token1, int24 tickSpacing, int24 startTick, address creator, address hooks, address feeRecipient, uint16 makerFeeBps, uint16 takerFeeBps)",
]);

// ---- Position NFT wrapper (FrontierPositionNFT) ---------------------------
// The "claim token": a tokenId that wraps a book positionId. Its ERC-721
// Transfer log drives the claim-token-flow ledger.
export const positionNftEventsAbi = parseAbi([
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
]);

// Read-only views the indexer uses to reconcile position ownership and the
// claim-token mapping after replaying logs.
export const bookViewAbi = parseAbi([
  "function currentTick() view returns (int24)",
  "function tickSpacing() view returns (int24)",
  "function positions(uint256 id) view returns (address owner, int24 lower, int24 upper, uint128 liquidity, int128 slope, uint64 depositClock, int24 claimedUpper, bool live, bool isBid)",
]);

export const positionNftViewAbi = parseAbi([
  "function bookPositionOf(uint256 tokenId) view returns (uint256)",
  "function tokenOf(uint256 positionId) view returns (uint256)",
  "function ownerOf(uint256 tokenId) view returns (address)",
]);

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;
