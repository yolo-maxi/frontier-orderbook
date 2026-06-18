import type { Address } from "viem";
import { frontierLensAbi } from "../abi/FrontierLens.js";
import { FrontierClientBase, type ClientOptions } from "./base.js";
import type { BookSummary, DepthLevel, Quote } from "../types.js";

/** Read-only quote/depth helper around `FrontierLens`. */
export class LensClient extends FrontierClientBase {
  readonly address: Address;

  constructor(address: Address, opts: ClientOptions) {
    super(opts);
    this.address = address;
  }

  private read<const F extends string>(functionName: F, args: readonly unknown[]) {
    return this.publicClient.readContract({
      address: this.address,
      abi: frontierLensAbi,
      functionName: functionName as never,
      args: args as never,
    });
  }

  /** Quote buying token0 with `amount1In` of token1. */
  async quoteBuy(book: Address, amount1In: bigint): Promise<Quote> {
    const r = (await this.read("quoteBuy", [book, amount1In])) as readonly [bigint, bigint, number];
    return { amountOut: r[0], amountSpent: r[1], endTick: r[2] };
  }

  /** Quote selling `amount0In` of token0 for token1. `maxRuns` bounds the scan. */
  async quoteSell(book: Address, amount0In: bigint, maxRuns: bigint): Promise<Quote> {
    const r = (await this.read("quoteSell", [book, amount0In, maxRuns])) as readonly [bigint, bigint, number];
    return { amountOut: r[0], amountSpent: r[1], endTick: r[2] };
  }

  /** Aggregated bid/ask depth levels between two ticks. */
  async depth(book: Address, fromTick: number, toTick: number, maxLevels: bigint): Promise<DepthLevel[]> {
    const levels = (await this.read("depth", [book, fromTick, toTick, maxLevels])) as readonly {
      tick: number;
      askSize: bigint;
      bidSize: bigint;
    }[];
    return levels.map((l) => ({ tick: l.tick, askSize: l.askSize, bidSize: l.bidSize }));
  }

  /** One-call book summary (current tick, spacing, tokens, best ask/bid). */
  async summary(book: Address, scanWindow: number): Promise<BookSummary> {
    const s = (await this.read("summary", [book, scanWindow])) as {
      currentTick: number;
      tickSpacing: number;
      token0: Address;
      token1: Address;
      bestAsk: number;
      bestBid: number;
    };
    return {
      currentTick: s.currentTick,
      tickSpacing: s.tickSpacing,
      token0: s.token0,
      token1: s.token1,
      bestAsk: s.bestAsk,
      bestBid: s.bestBid,
    };
  }
}
