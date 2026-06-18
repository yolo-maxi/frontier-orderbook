import type { Address, Hex } from "viem";
import { geometricFrontierBookAbi } from "../abi/GeometricFrontierBook.js";
import { FrontierClientBase, type ClientOptions } from "./base.js";
import type { BookConfig, Position } from "../types.js";

/**
 * Typed wrapper around a single `GeometricFrontierBook`. Exposes read views and
 * the raw maker/taker write entrypoints. Higher-level orchestration (approvals,
 * quoting, slippage) lives in MakerAgent / TakerAgent.
 */
export class BookClient extends FrontierClientBase {
  readonly address: Address;

  constructor(address: Address, opts: ClientOptions) {
    super(opts);
    this.address = address;
  }

  private read<const F extends string>(functionName: F, args: readonly unknown[] = []) {
    return this.publicClient.readContract({
      address: this.address,
      abi: geometricFrontierBookAbi,
      functionName: functionName as never,
      args: args as never,
    });
  }

  private write<const F extends string>(functionName: F, args: readonly unknown[] = []): Promise<Hex> {
    const wallet = this.requireWallet();
    return wallet.writeContract({
      chain: wallet.chain,
      account: this.requireAccount(),
      address: this.address,
      abi: geometricFrontierBookAbi,
      functionName: functionName as never,
      args: args as never,
    });
  }

  // --- reads -------------------------------------------------------------

  async token0(): Promise<Address> {
    return this.read("token0") as Promise<Address>;
  }

  async token1(): Promise<Address> {
    return this.read("token1") as Promise<Address>;
  }

  async tickSpacing(): Promise<number> {
    return this.read("tickSpacing") as Promise<number>;
  }

  async currentTick(): Promise<number> {
    return this.read("currentTick") as Promise<number>;
  }

  async makerFeeBps(): Promise<number> {
    return this.read("makerFeeBps") as Promise<number>;
  }

  async takerFeeBps(): Promise<number> {
    return this.read("takerFeeBps") as Promise<number>;
  }

  async feeRecipient(): Promise<Address> {
    return this.read("feeRecipient") as Promise<Address>;
  }

  /** Fetch the full static + dynamic config of the book in one batch. */
  async config(): Promise<BookConfig> {
    const [token0, token1, tickSpacing, currentTick, feeRecipient, makerFeeBps, takerFeeBps, hooks, permissions] =
      await Promise.all([
        this.token0(),
        this.token1(),
        this.tickSpacing(),
        this.currentTick(),
        this.feeRecipient(),
        this.makerFeeBps(),
        this.takerFeeBps(),
        this.read("hooks") as Promise<Address>,
        this.read("permissions") as Promise<Address>,
      ]);
    return {
      address: this.address,
      token0,
      token1,
      tickSpacing,
      currentTick,
      feeRecipient,
      makerFeeBps,
      takerFeeBps,
      hooks,
      permissions,
    };
  }

  /** Decode a position record. */
  async position(positionId: bigint): Promise<Position> {
    const r = (await this.read("positions", [positionId])) as readonly [
      Address,
      number,
      number,
      bigint,
      bigint,
      number,
      boolean,
      boolean,
    ];
    return {
      owner: r[0],
      lower: r[1],
      upper: r[2],
      liquidity: r[3],
      depositClock: r[4],
      claimedUpper: r[5],
      live: r[6],
      isBid: r[7],
    };
  }

  /** Net claimable token1 for an ask position (after maker fee). */
  async claimable(positionId: bigint): Promise<bigint> {
    return this.read("claimable", [positionId]) as Promise<bigint>;
  }

  /** Net claimable token0 for a bid position (after maker fee). */
  async bidClaimable(positionId: bigint): Promise<bigint> {
    return this.read("bidClaimable", [positionId]) as Promise<bigint>;
  }

  async unfilledPrincipal(positionId: bigint): Promise<bigint> {
    return this.read("unfilledPrincipal", [positionId]) as Promise<bigint>;
  }

  async bidRefundable(positionId: bigint): Promise<bigint> {
    return this.read("bidRefundable", [positionId]) as Promise<bigint>;
  }

  // --- ask maker writes --------------------------------------------------

  deposit(lower: number, upper: number, liquidity: bigint): Promise<Hex> {
    return this.write("deposit", [lower, upper, liquidity]);
  }

  claim(positionId: bigint): Promise<Hex> {
    return this.write("claim", [positionId]);
  }

  claimTo(positionId: bigint, target: number): Promise<Hex> {
    return this.write("claimTo", [positionId, target]);
  }

  cancel(positionId: bigint): Promise<Hex> {
    return this.write("cancel", [positionId]);
  }

  cancelWithWitness(positionId: bigint, frontier: number): Promise<Hex> {
    return this.write("cancelWithWitness", [positionId, frontier]);
  }

  requote(positionId: bigint, newLower: number, newUpper: number, newLiquidity: bigint): Promise<Hex> {
    return this.write("requote", [positionId, newLower, newUpper, newLiquidity]);
  }

  // --- bid maker writes --------------------------------------------------

  depositBid(lower: number, upper: number, liquidity: bigint): Promise<Hex> {
    return this.write("depositBid", [lower, upper, liquidity]);
  }

  claimBid(positionId: bigint): Promise<Hex> {
    return this.write("claimBid", [positionId]);
  }

  claimBidTo(positionId: bigint, target: number): Promise<Hex> {
    return this.write("claimBidTo", [positionId, target]);
  }

  cancelBid(positionId: bigint): Promise<Hex> {
    return this.write("cancelBid", [positionId]);
  }

  cancelBidWithWitness(positionId: bigint, frontier: number): Promise<Hex> {
    return this.write("cancelBidWithWitness", [positionId, frontier]);
  }

  requoteBid(positionId: bigint, newLower: number, newUpper: number, newLiquidity: bigint): Promise<Hex> {
    return this.write("requoteBid", [positionId, newLower, newUpper, newLiquidity]);
  }

  transferPosition(positionId: bigint, to: Address): Promise<Hex> {
    return this.write("transferPosition", [positionId, to]);
  }

  // --- direct taker write -------------------------------------------------

  /**
   * Advanced direct sweep. Prefer {@link TakerAgent} (router path) for normal
   * swaps. Always set `maxFills`, `maxPay`, `minOut`, and `deadline`.
   */
  sweepWithLimits(
    target: number,
    maxFills: bigint,
    maxPay: bigint,
    minOut: bigint,
    deadline: bigint,
  ): Promise<Hex> {
    return this.write("sweepWithLimits", [target, maxFills, maxPay, minOut, deadline]);
  }
}
