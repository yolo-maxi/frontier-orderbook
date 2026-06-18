import type { Address, Hex } from "viem";
import { BookClient } from "./book.js";
import { Erc20Client } from "./erc20.js";
import { type ClientOptions } from "./base.js";
import { ceilToSpacing, floorToSpacing, isTickAligned } from "../utils.js";
import type { Side } from "../types.js";

/**
 * High-level maker orchestration over a single book: validates ranges, handles
 * approvals, and places/manages ask and bid positions.
 *
 * - Asks sell token0 for token1 over a range strictly above the current tick.
 * - Bids buy token0 with token1 over a range at or below the current tick.
 */
export class MakerAgent {
  readonly book: BookClient;
  private readonly opts: ClientOptions;

  constructor(bookAddress: Address, opts: ClientOptions) {
    this.book = new BookClient(bookAddress, opts);
    this.opts = opts;
  }

  /** Validate that a range is spacing-aligned and ordered for the given side. */
  async validateRange(side: Side, lower: number, upper: number): Promise<void> {
    const spacing = await this.book.tickSpacing();
    if (!isTickAligned(lower, spacing) || !isTickAligned(upper, spacing)) {
      throw new Error(`ticks must be aligned to spacing ${spacing}`);
    }
    if (lower >= upper) throw new Error("lower must be < upper");
    const current = await this.book.currentTick();
    if (side === "ask" && lower < current) {
      throw new Error(`ask range must be above currentTick (${current}); got lower=${lower}`);
    }
    if (side === "bid" && upper > current) {
      throw new Error(`bid range must be at or below currentTick (${current}); got upper=${upper}`);
    }
  }

  /**
   * Place an ask: sell token0 over [lower, upper). Approves `inputApproval` of
   * token0 to the book (defaults to `liquidity`) then deposits.
   */
  async placeAsk(
    lower: number,
    upper: number,
    liquidity: bigint,
    inputApproval?: bigint,
  ): Promise<Hex> {
    await this.validateRange("ask", lower, upper);
    const token0 = (await this.book.token0()) as Address;
    await this.approveIfNeeded(token0, inputApproval ?? liquidity);
    return this.book.deposit(lower, upper, liquidity);
  }

  /**
   * Place a bid: buy token0 over [lower, upper). The quote (token1) needed is
   * supplied via `quoteApproval` because it depends on the geometric curve;
   * compute it with the lens or your own quoting engine.
   */
  async placeBid(
    lower: number,
    upper: number,
    liquidity: bigint,
    quoteApproval: bigint,
  ): Promise<Hex> {
    await this.validateRange("bid", lower, upper);
    const token1 = (await this.book.token1()) as Address;
    await this.approveIfNeeded(token1, quoteApproval);
    return this.book.depositBid(lower, upper, liquidity);
  }

  /**
   * Helper to build an ask range `count` levels wide starting `offset` spacings
   * above the current tick.
   */
  async askRangeAbove(offsetSpacings: number, widthSpacings: number): Promise<{ lower: number; upper: number }> {
    const spacing = await this.book.tickSpacing();
    const current = await this.book.currentTick();
    const lower = ceilToSpacing(current, spacing) + offsetSpacings * spacing;
    return { lower, upper: lower + widthSpacings * spacing };
  }

  /** Helper to build a bid range `width` levels wide ending at/below current. */
  async bidRangeBelow(offsetSpacings: number, widthSpacings: number): Promise<{ lower: number; upper: number }> {
    const spacing = await this.book.tickSpacing();
    const current = await this.book.currentTick();
    const upper = floorToSpacing(current, spacing) - offsetSpacings * spacing;
    return { lower: upper - widthSpacings * spacing, upper };
  }

  claim(side: Side, positionId: bigint): Promise<Hex> {
    return side === "ask" ? this.book.claim(positionId) : this.book.claimBid(positionId);
  }

  cancel(side: Side, positionId: bigint): Promise<Hex> {
    return side === "ask" ? this.book.cancel(positionId) : this.book.cancelBid(positionId);
  }

  /** Net claimable proceeds for a position (token1 for asks, token0 for bids). */
  claimable(side: Side, positionId: bigint): Promise<bigint> {
    return side === "ask" ? this.book.claimable(positionId) : this.book.bidClaimable(positionId);
  }

  requote(
    side: Side,
    positionId: bigint,
    newLower: number,
    newUpper: number,
    newLiquidity: bigint,
  ): Promise<Hex> {
    return side === "ask"
      ? this.book.requote(positionId, newLower, newUpper, newLiquidity)
      : this.book.requoteBid(positionId, newLower, newUpper, newLiquidity);
  }

  private async approveIfNeeded(token: Address, amount: bigint): Promise<void> {
    const erc20 = new Erc20Client(token, this.opts);
    const account = this.opts.account ?? this.opts.walletClient?.account;
    if (!account) throw new Error("MakerAgent requires a wallet account for approvals");
    const owner = (typeof account === "string" ? account : account.address) as Address;
    await erc20.ensureAllowance(owner, this.book.address, amount);
  }
}
