import { describe, expect, it } from "vitest";
import {
  applySlippage,
  ceilToSpacing,
  deadlineFromNow,
  floorToSpacing,
  grossInputWithTakerFee,
  isTickAligned,
  netProceedsAfterMakerFee,
  priceToTick,
  tickToPrice,
} from "../src/utils.js";

describe("applySlippage", () => {
  it("reduces output by the bps tolerance", () => {
    expect(applySlippage(10_000n, 50)).toBe(9950n);
    expect(applySlippage(10_000n, 0)).toBe(10_000n);
    expect(applySlippage(10_000n, 10_000)).toBe(0n);
  });
  it("rejects out-of-range bps", () => {
    expect(() => applySlippage(1n, -1)).toThrow();
    expect(() => applySlippage(1n, 10_001)).toThrow();
  });
});

describe("fee math", () => {
  it("adds taker fee on top of gross input", () => {
    expect(grossInputWithTakerFee(10_000n, 30)).toBe(10_030n);
    expect(grossInputWithTakerFee(10_000n, 0)).toBe(10_000n);
  });
  it("subtracts maker fee from proceeds", () => {
    expect(netProceedsAfterMakerFee(10_000n, 100)).toBe(9_900n);
    expect(netProceedsAfterMakerFee(10_000n, 0)).toBe(10_000n);
  });
});

describe("tick helpers", () => {
  it("checks spacing alignment", () => {
    expect(isTickAligned(60, 60)).toBe(true);
    expect(isTickAligned(61, 60)).toBe(false);
    expect(isTickAligned(0, 60)).toBe(true);
    expect(isTickAligned(-120, 60)).toBe(true);
  });
  it("floors and ceils to spacing", () => {
    expect(floorToSpacing(61, 60)).toBe(60);
    expect(ceilToSpacing(61, 60)).toBe(120);
    expect(floorToSpacing(-1, 60)).toBe(-60);
    expect(ceilToSpacing(-1, 60)).toBe(-0);
  });
  it("round-trips price/tick approximately", () => {
    expect(tickToPrice(0)).toBeCloseTo(1, 10);
    const t = priceToTick(tickToPrice(120));
    expect(t).toBeCloseTo(120, 6);
  });
});

describe("deadlineFromNow", () => {
  it("returns a future unix timestamp", () => {
    const now = BigInt(Math.floor(Date.now() / 1000));
    expect(deadlineFromNow(300)).toBeGreaterThanOrEqual(now + 299n);
  });
});
