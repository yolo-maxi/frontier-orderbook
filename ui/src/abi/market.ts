// DarkBoxBinaryMarket — collateral vault that mints/burns paired YES+NO
// outcome tokens (split / merge / join) and redeems winners after resolution.
// Signatures verified against the deployed Arc artifact
// (packages/contracts/out/DarkBoxBinaryMarket.sol).
export const marketAbi = [
  {
    type: "function",
    name: "split",
    stateMutability: "nonpayable",
    inputs: [
      { name: "amount", type: "uint256" },
      { name: "receiver", type: "address" },
    ],
    outputs: [
      { name: "yesAmount", type: "uint256" },
      { name: "noAmount", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "merge",
    stateMutability: "nonpayable",
    inputs: [
      { name: "amount", type: "uint256" },
      { name: "receiver", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "join",
    stateMutability: "nonpayable",
    inputs: [
      { name: "amount", type: "uint256" },
      { name: "receiver", type: "address" },
    ],
    outputs: [{ name: "collateralReturned", type: "uint256" }],
  },
  {
    type: "function",
    name: "redeem",
    stateMutability: "nonpayable",
    inputs: [
      { name: "outcome", type: "uint8" },
      { name: "amount", type: "uint256" },
      { name: "receiver", type: "address" },
    ],
    outputs: [{ name: "collateralReturned", type: "uint256" }],
  },
  { type: "function", name: "yesToken", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
  { type: "function", name: "noToken", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
  {
    type: "function",
    name: "collateralToken",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "vaultCollateral",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  { type: "function", name: "status", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint8" }] },
  {
    type: "function",
    name: "resolvedOutcome",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
  { type: "function", name: "marketId", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "bytes32" }] },
  {
    type: "event",
    name: "Split",
    anonymous: false,
    inputs: [
      { name: "marketId", type: "bytes32", indexed: true },
      { name: "caller", type: "address", indexed: true },
      { name: "receiver", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
] as const;

/** Outcome enum on DarkBoxBinaryMarket: { Unset, Yes, No, Invalid }. */
export const OUTCOME = { Unset: 0, Yes: 1, No: 2, Invalid: 3 } as const;

/** MarketStatus enum: { Draft, Active, Paused, Closed, Resolved, Voided }. */
export const MARKET_STATUS = ["Draft", "Active", "Paused", "Closed", "Resolved", "Voided"] as const;
