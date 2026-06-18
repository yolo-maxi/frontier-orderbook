import { decodeEventLog, getAddress, isAddressEqual, zeroAddress, type Address, type Hex } from "viem";
import { frontierGeoBookFactoryAbi } from "../abi/FrontierGeoBookFactory.js";
import { MAX_FEE_BPS } from "../constants.js";
import { isTickAligned } from "../utils.js";
import { FrontierClientBase, type ClientOptions } from "./base.js";
import type { CreateMarketParams } from "../types.js";

/**
 * Creates and looks up geometric markets through `FrontierGeoBookFactory`.
 *
 * Validation mirrors the contract + skill.md required checks so agents fail
 * fast in TypeScript before paying gas.
 */
export class MarketCreator extends FrontierClientBase {
  readonly factory: Address;

  constructor(factory: Address, opts: ClientOptions) {
    super(opts);
    this.factory = factory;
  }

  /**
   * Validate market parameters against the contract's invariants and the
   * skill.md checklist. Throws on the first problem found.
   */
  static validate(p: CreateMarketParams): void {
    if (isAddressEqual(p.token0, p.token1)) throw new Error("token0 must differ from token1");
    if (isAddressEqual(p.token0, zeroAddress) || isAddressEqual(p.token1, zeroAddress)) {
      throw new Error("token addresses must be non-zero");
    }
    if (p.tickSpacing <= 0) throw new Error("tickSpacing must be > 0");
    if (!isTickAligned(p.startTick, p.tickSpacing)) {
      throw new Error("startTick must be aligned to tickSpacing");
    }
    const maker = p.makerFeeBps ?? 0;
    const taker = p.takerFeeBps ?? 0;
    if (maker > MAX_FEE_BPS) throw new Error(`makerFeeBps must be <= ${MAX_FEE_BPS}`);
    if (taker > MAX_FEE_BPS) throw new Error(`takerFeeBps must be <= ${MAX_FEE_BPS}`);
    if ((maker > 0 || taker > 0) && (!p.feeRecipient || isAddressEqual(p.feeRecipient, zeroAddress))) {
      throw new Error("feeRecipient is required when either fee is non-zero");
    }
  }

  /** Existing default (first-created) book for a pair, or zero address. */
  async defaultBook(token0: Address, token1: Address): Promise<Address> {
    return this.publicClient.readContract({
      address: this.factory,
      abi: frontierGeoBookFactoryAbi,
      functionName: "defaultBook",
      args: [token0, token1],
    });
  }

  /** Book for a pair + specific spacing, or zero address. */
  async getBook(token0: Address, token1: Address, tickSpacing: number): Promise<Address> {
    return this.publicClient.readContract({
      address: this.factory,
      abi: frontierGeoBookFactoryAbi,
      functionName: "getBook",
      args: [token0, token1, tickSpacing],
    });
  }

  async bookCount(): Promise<bigint> {
    return this.publicClient.readContract({
      address: this.factory,
      abi: frontierGeoBookFactoryAbi,
      functionName: "bookCount",
    });
  }

  /**
   * Create a market (fee-enabled when fees are non-zero, zero-fee otherwise).
   * Returns the tx hash; use {@link createMarketAndWait} to also get the book
   * address from the BookCreated event.
   */
  async createMarket(p: CreateMarketParams): Promise<Hex> {
    MarketCreator.validate(p);
    const wallet = this.requireWallet();
    const account = this.requireAccount();
    const maker = p.makerFeeBps ?? 0;
    const taker = p.takerFeeBps ?? 0;
    if (maker === 0 && taker === 0 && !p.feeRecipient) {
      return wallet.writeContract({
        chain: wallet.chain,
        account,
        address: this.factory,
        abi: frontierGeoBookFactoryAbi,
        functionName: "createGeoBook",
        args: [p.token0, p.token1, p.tickSpacing, p.startTick],
      });
    }
    return wallet.writeContract({
      chain: wallet.chain,
      account,
      address: this.factory,
      abi: frontierGeoBookFactoryAbi,
      functionName: "createGeoBookWithFees",
      args: [
        p.token0,
        p.token1,
        p.tickSpacing,
        p.startTick,
        p.feeRecipient ?? zeroAddress,
        maker,
        taker,
      ],
    });
  }

  /**
   * Create a market, wait for the receipt, and decode the new book address
   * from the `BookCreated` event.
   */
  async createMarketAndWait(p: CreateMarketParams): Promise<{ hash: Hex; book: Address }> {
    const hash = await this.createMarket(p);
    const receipt = await this.waitForReceipt(hash);
    for (const log of receipt.logs) {
      if (!isAddressEqual(log.address, this.factory)) continue;
      try {
        const decoded = decodeEventLog({
          abi: frontierGeoBookFactoryAbi,
          data: log.data,
          topics: log.topics,
        });
        if (decoded.eventName === "BookCreated") {
          const args = decoded.args as { book: Address };
          return { hash, book: getAddress(args.book) };
        }
      } catch {
        // not the event we want; keep scanning
      }
    }
    throw new Error("BookCreated event not found in receipt");
  }
}
