export type MarketMode = "prediction" | "spot";

export interface MarketProfile {
  mode: MarketMode;
  toggleLabel: string;
  pairLabel: string;
  baseSymbol: string;
  quoteSymbol: string;
  baseGlyph: string;
  quoteGlyph: string;
  priceUnit: string;
  limitPriceUnit: string;
  priceColumn: string;
  sizeColumn: string;
  valueColumn: string;
  buyLabel: string;
  sellLabel: string;
  bidNote: string;
  askNote: string;
  limitBuyReceive: string;
  limitSellReceive: string;
  makerBidButton: string;
  makerAskButton: string;
  makerBidLabel: string;
  makerAskLabel: string;
  claimBidSymbol: string;
  claimAskSymbol: string;
  restBidSymbol: string;
  restAskSymbol: string;
  emptyPositions: string;
  emptyPositionsHint: string;
  faucetTitle: string;
}

export const MARKET_PROFILES: Record<MarketMode, MarketProfile> = {
  prediction: {
    mode: "prediction",
    toggleLabel: "Prediction",
    pairLabel: "Frontier outcome / USDC",
    baseSymbol: "YES",
    quoteSymbol: "USDC",
    baseGlyph: "Y",
    quoteGlyph: "U",
    priceUnit: "YES probability",
    limitPriceUnit: "YES probability",
    priceColumn: "Chance",
    sizeColumn: "Size (YES)",
    valueColumn: "Cost (USDC)",
    buyLabel: "Buy YES",
    sellLabel: "Sell YES",
    bidNote: "buy YES",
    askNote: "sell YES",
    limitBuyReceive: "YES",
    limitSellReceive: "USDC",
    makerBidButton: "Place Bid Ladder",
    makerAskButton: "Place Ask Ladder",
    makerBidLabel: "Bid",
    makerAskLabel: "Ask",
    claimBidSymbol: "YES",
    claimAskSymbol: "USDC",
    restBidSymbol: "USDC",
    restAskSymbol: "YES",
    emptyPositions: "No prediction-maker positions yet.",
    emptyPositionsHint: "Place a ladder from the Make tab - fills accrue here.",
    faucetTitle: "Mint demo YES + USDC to the demo wallet",
  },
  spot: {
    mode: "spot",
    toggleLabel: "ETH/USDC",
    pairLabel: "ETH / USDC",
    baseSymbol: "WETH",
    quoteSymbol: "USDC",
    baseGlyph: "E",
    quoteGlyph: "U",
    priceUnit: "USDC per WETH",
    limitPriceUnit: "USDC per WETH",
    priceColumn: "Price (USDC)",
    sizeColumn: "Size (WETH)",
    valueColumn: "Value (USDC)",
    buyLabel: "Buy WETH",
    sellLabel: "Sell WETH",
    bidNote: "buy WETH",
    askNote: "sell WETH",
    limitBuyReceive: "WETH",
    limitSellReceive: "USDC",
    makerBidButton: "Place Bid Ladder",
    makerAskButton: "Place Ask Ladder",
    makerBidLabel: "Bid",
    makerAskLabel: "Ask",
    claimBidSymbol: "WETH",
    claimAskSymbol: "USDC",
    restBidSymbol: "USDC",
    restAskSymbol: "WETH",
    emptyPositions: "No maker positions yet.",
    emptyPositionsHint: "Place a ladder from the Make tab - fills accrue here.",
    faucetTitle: "Mint 10 WETH + 50,000 USDC to the demo wallet",
  },
};

export const DEFAULT_MARKET_MODE: MarketMode = "prediction";

// ----------------------------------------------------------------------------
// P1 / P2 — prediction-market metadata + discovery catalog
//
// The live book is a single tick ladder; these descriptors layer Polymarket-
// style metadata on top of it for the prediction-mode UI (question, category,
// resolution date) and give the discovery browser a set of cards to filter.
// `live` marks the market wired to the on-chain book; the rest are illustrative
// discovery entries that demonstrate the browse/search/filter surface and can
// be swapped for indexer-served markets without touching the components.
// ----------------------------------------------------------------------------

export type MarketCategory = "Crypto" | "Politics" | "Macro" | "Tech" | "Sports" | "Culture";

export interface PredictionMeta {
  id: string;
  question: string;
  category: MarketCategory;
  /** ISO date the market resolves. */
  resolutionDate: string;
  /** Short resolution criteria shown in the metadata strip + cards. */
  resolution: string;
  /** Cumulative notional traded, in quote units (USDC) — display only. */
  volume: number;
  /** Open interest / liquidity, in quote units (USDC) — display only. */
  liquidity: number;
  /** Seed probability (0..1) for cards that aren't wired to the live book. */
  seedProbability: number;
  /** When true this card maps to the on-chain book and reads its live price. */
  live: boolean;
}

export const PREDICTION_CATALOG: PredictionMeta[] = [
  {
    id: "frontier-live",
    question: "Will the Frontier outcome resolve YES at settlement?",
    category: "Crypto",
    resolutionDate: "2026-12-31",
    resolution: "Resolves YES if the on-chain oracle reports the outcome as true at expiry.",
    volume: 1_284_500,
    liquidity: 312_000,
    seedProbability: 0.5,
    live: true,
  },
  {
    id: "eth-5k",
    question: "Will ETH close above $5,000 before 2026 ends?",
    category: "Crypto",
    resolutionDate: "2026-12-31",
    resolution: "Resolves YES if ETH/USD prints above $5,000 on any major venue close.",
    volume: 8_940_000,
    liquidity: 1_120_000,
    seedProbability: 0.62,
    live: false,
  },
  {
    id: "btc-150k",
    question: "Will BTC reach $150,000 in 2026?",
    category: "Crypto",
    resolutionDate: "2026-12-31",
    resolution: "Resolves YES if BTC/USD trades at or above $150,000 at any point in 2026.",
    volume: 22_100_000,
    liquidity: 3_400_000,
    seedProbability: 0.41,
    live: false,
  },
  {
    id: "fed-cut-q3",
    question: "Will the Fed cut rates at the Q3 2026 meeting?",
    category: "Macro",
    resolutionDate: "2026-09-30",
    resolution: "Resolves YES if the FOMC lowers the target range at its Q3 meeting.",
    volume: 5_320_000,
    liquidity: 870_000,
    seedProbability: 0.73,
    live: false,
  },
  {
    id: "us-election-turnout",
    question: "Will the 2026 midterm turnout exceed 50%?",
    category: "Politics",
    resolutionDate: "2026-11-03",
    resolution: "Resolves YES if certified voter turnout exceeds 50% of eligible voters.",
    volume: 3_010_000,
    liquidity: 640_000,
    seedProbability: 0.48,
    live: false,
  },
  {
    id: "ai-model-2026",
    question: "Will a frontier lab ship a model > 10T params in 2026?",
    category: "Tech",
    resolutionDate: "2026-12-31",
    resolution: "Resolves YES on a credible public disclosure of a >10T parameter model.",
    volume: 1_760_000,
    liquidity: 410_000,
    seedProbability: 0.34,
    live: false,
  },
  {
    id: "worldcup-host",
    question: "Will the host nation reach the 2026 World Cup semifinals?",
    category: "Sports",
    resolutionDate: "2026-07-19",
    resolution: "Resolves YES if a host nation advances to the semifinal stage.",
    volume: 6_450_000,
    liquidity: 980_000,
    seedProbability: 0.28,
    live: false,
  },
  {
    id: "box-office",
    question: "Will the top 2026 film gross over $2B worldwide?",
    category: "Culture",
    resolutionDate: "2026-12-31",
    resolution: "Resolves YES if any 2026 release surpasses $2B in worldwide box office.",
    volume: 920_000,
    liquidity: 220_000,
    seedProbability: 0.19,
    live: false,
  },
];

export const LIVE_PREDICTION_MARKET: PredictionMeta =
  PREDICTION_CATALOG.find((m) => m.live) ?? PREDICTION_CATALOG[0];

export const PREDICTION_CATEGORIES: MarketCategory[] = [
  "Crypto",
  "Politics",
  "Macro",
  "Tech",
  "Sports",
  "Culture",
];
