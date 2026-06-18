import { describe, expect, it } from "vitest";
import { toFunctionSelector } from "viem";
import { geometricFrontierBookAbi } from "../src/abi/GeometricFrontierBook.js";
import { frontierRouterAbi } from "../src/abi/FrontierRouter.js";
import { BOOK_SELECTORS } from "../src/constants.js";

function hasFn(abi: readonly { type: string; name?: string }[], name: string): boolean {
  return abi.some((e) => e.type === "function" && e.name === name);
}

describe("bundled ABIs", () => {
  it("book ABI exposes the deploy-day surface", () => {
    for (const fn of [
      "deposit",
      "depositBid",
      "claim",
      "claimBid",
      "cancel",
      "cancelBid",
      "requote",
      "requoteBid",
      "transferPosition",
      "sweepWithLimits",
      "currentTick",
      "tickSpacing",
      "positions",
      "makerFeeBps",
      "takerFeeBps",
    ]) {
      expect(hasFn(geometricFrontierBookAbi, fn), fn).toBe(true);
    }
  });

  it("does not expose removed shaped-ladder surface", () => {
    expect(hasFn(geometricFrontierBookAbi, "depositShaped")).toBe(false);
    expect(hasFn(geometricFrontierBookAbi, "requoteShaped")).toBe(false);
    expect(hasFn(geometricFrontierBookAbi, "frontierSlope")).toBe(false);
  });

  it("router ABI exposes exact-input entrypoints", () => {
    expect(hasFn(frontierRouterAbi, "buyExactIn")).toBe(true);
    expect(hasFn(frontierRouterAbi, "sellExactIn")).toBe(true);
  });
});

describe("BOOK_SELECTORS", () => {
  it("match selectors computed from the bundled ABI", () => {
    for (const [name, expected] of Object.entries(BOOK_SELECTORS)) {
      const entry = geometricFrontierBookAbi.find(
        (e) => e.type === "function" && e.name === name,
      );
      expect(entry, name).toBeTruthy();
      const sig = `${name}(${(entry as { inputs: { type: string }[] }).inputs
        .map((i) => i.type)
        .join(",")})`;
      expect(toFunctionSelector(sig), name).toBe(expected);
    }
  });
});
