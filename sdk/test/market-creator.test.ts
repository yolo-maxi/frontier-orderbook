import { describe, expect, it } from "vitest";
import { getAddress, zeroAddress } from "viem";
import { MarketCreator } from "../src/clients/market-creator.js";
import type { CreateMarketParams } from "../src/types.js";

const A = getAddress("0x1111111111111111111111111111111111111111");
const B = getAddress("0x2222222222222222222222222222222222222222");
const FEE = getAddress("0x3333333333333333333333333333333333333333");

function base(over: Partial<CreateMarketParams> = {}): CreateMarketParams {
  return { token0: A, token1: B, tickSpacing: 60, startTick: 0, ...over };
}

describe("MarketCreator.validate", () => {
  it("accepts a valid zero-fee market", () => {
    expect(() => MarketCreator.validate(base())).not.toThrow();
  });
  it("accepts a valid fee-enabled market", () => {
    expect(() =>
      MarketCreator.validate(base({ makerFeeBps: 0, takerFeeBps: 30, feeRecipient: FEE })),
    ).not.toThrow();
  });
  it("rejects identical tokens", () => {
    expect(() => MarketCreator.validate(base({ token1: A }))).toThrow(/differ/);
  });
  it("rejects zero token address", () => {
    expect(() => MarketCreator.validate(base({ token0: zeroAddress }))).toThrow(/non-zero/);
  });
  it("rejects non-positive spacing", () => {
    expect(() => MarketCreator.validate(base({ tickSpacing: 0 }))).toThrow(/tickSpacing/);
  });
  it("rejects unaligned start tick", () => {
    expect(() => MarketCreator.validate(base({ startTick: 61 }))).toThrow(/aligned/);
  });
  it("rejects fee over max", () => {
    expect(() =>
      MarketCreator.validate(base({ takerFeeBps: 1001, feeRecipient: FEE })),
    ).toThrow(/<=/);
  });
  it("rejects non-zero fee without recipient", () => {
    expect(() => MarketCreator.validate(base({ takerFeeBps: 30 }))).toThrow(/feeRecipient/);
  });
});
