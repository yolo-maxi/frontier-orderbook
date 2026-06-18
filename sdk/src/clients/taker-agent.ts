import { getAddress, type Address, type Hex } from "viem";
import { frontierRouterAbi } from "../abi/FrontierRouter.js";
import { BookClient } from "./book.js";
import { Erc20Client } from "./erc20.js";
import { LensClient } from "./lens.js";
import { FrontierClientBase, type ClientOptions } from "./base.js";
import { applySlippage, deadlineFromNow, grossInputWithTakerFee } from "../utils.js";
import type { Quote, SwapParams, TakeDirection } from "../types.js";

/**
 * High-level taker orchestration: quote through the lens, apply slippage,
 * approve the router for input + taker fee, then execute exact-input swaps.
 */
export class TakerAgent extends FrontierClientBase {
  readonly router: Address;
  readonly lens: LensClient;
  private readonly opts: ClientOptions;

  constructor(routerAddress: Address, lensAddress: Address, opts: ClientOptions) {
    super(opts);
    this.router = routerAddress;
    this.lens = new LensClient(lensAddress, opts);
    this.opts = opts;
  }

  /** Quote a buy (token1 -> token0). */
  quoteBuy(book: Address, amount1In: bigint): Promise<Quote> {
    return this.lens.quoteBuy(book, amount1In);
  }

  /** Quote a sell (token0 -> token1). */
  quoteSell(book: Address, amount0In: bigint, maxRuns = 256n): Promise<Quote> {
    return this.lens.quoteSell(book, amount0In, maxRuns);
  }

  /**
   * Buy token0 with token1 through the router. If `minOut` is omitted the agent
   * quotes and applies `slippageBps` (default 50 = 0.50%).
   */
  async buy(book: Address, params: SwapParams & { slippageBps?: number }): Promise<Hex> {
    const minOut = await this.resolveMinOut(book, "buy", params);
    const to = (params.to ?? this.ownerAddress()) as Address;
    const deadline = params.deadline ?? deadlineFromNow();
    await this.approveRouterFor(book, "buy", params.amountIn);
    return this.execRouter("buyExactIn", [book, params.amountIn, minOut, to, deadline]);
  }

  /** Sell token0 for token1 through the router. */
  async sell(book: Address, params: SwapParams & { slippageBps?: number; maxRuns?: bigint }): Promise<Hex> {
    const minOut = await this.resolveMinOut(book, "sell", params);
    const to = (params.to ?? this.ownerAddress()) as Address;
    const deadline = params.deadline ?? deadlineFromNow();
    await this.approveRouterFor(book, "sell", params.amountIn);
    return this.execRouter("sellExactIn", [book, params.amountIn, minOut, to, deadline]);
  }

  private async resolveMinOut(
    book: Address,
    dir: TakeDirection,
    params: SwapParams & { slippageBps?: number; maxRuns?: bigint },
  ): Promise<bigint> {
    if (params.minOut > 0n) return params.minOut;
    const slippageBps = params.slippageBps ?? 50;
    const quote =
      dir === "buy"
        ? await this.quoteBuy(book, params.amountIn)
        : await this.quoteSell(book, params.amountIn, params.maxRuns ?? 256n);
    return applySlippage(quote.amountOut, slippageBps);
  }

  private async approveRouterFor(book: Address, dir: TakeDirection, amountIn: bigint): Promise<void> {
    const bookClient = new BookClient(book, this.opts);
    const [token, takerFeeBps] = await Promise.all([
      dir === "buy" ? bookClient.token1() : bookClient.token0(),
      bookClient.takerFeeBps(),
    ]);
    const needed = grossInputWithTakerFee(amountIn, takerFeeBps);
    const erc20 = new Erc20Client(token as Address, this.opts);
    await erc20.ensureAllowance(this.ownerAddress(), this.router, needed);
  }

  private execRouter<const F extends string>(functionName: F, args: readonly unknown[]): Promise<Hex> {
    const wallet = this.requireWallet();
    return wallet.writeContract({
      chain: wallet.chain,
      account: this.requireAccount(),
      address: this.router,
      abi: frontierRouterAbi,
      functionName: functionName as never,
      args: args as never,
    });
  }

  private ownerAddress(): Address {
    const account = this.account ?? this.walletClient?.account;
    if (!account) throw new Error("TakerAgent requires a wallet account");
    return getAddress(typeof account === "string" ? account : account.address);
  }
}
