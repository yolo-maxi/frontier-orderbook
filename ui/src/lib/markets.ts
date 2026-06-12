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
    priceUnit: "USDC per YES",
    limitPriceUnit: "USDC per YES",
    priceColumn: "Price (USDC)",
    sizeColumn: "Size (YES)",
    valueColumn: "Value (USDC)",
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
