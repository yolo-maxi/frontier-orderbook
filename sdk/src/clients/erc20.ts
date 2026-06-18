import { erc20Abi, type Address, type Hex } from "viem";
import { FrontierClientBase, type ClientOptions } from "./base.js";

/** Minimal ERC20 helper for approvals and balance reads. */
export class Erc20Client extends FrontierClientBase {
  readonly address: Address;

  constructor(address: Address, opts: ClientOptions) {
    super(opts);
    this.address = address;
  }

  async allowance(owner: Address, spender: Address): Promise<bigint> {
    return this.publicClient.readContract({
      address: this.address,
      abi: erc20Abi,
      functionName: "allowance",
      args: [owner, spender],
    });
  }

  async balanceOf(owner: Address): Promise<bigint> {
    return this.publicClient.readContract({
      address: this.address,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [owner],
    });
  }

  approve(spender: Address, amount: bigint): Promise<Hex> {
    const wallet = this.requireWallet();
    return wallet.writeContract({
      chain: wallet.chain,
      account: this.requireAccount(),
      address: this.address,
      abi: erc20Abi,
      functionName: "approve",
      args: [spender, amount],
    });
  }

  /**
   * Ensure `spender` has at least `amount` allowance from `owner`, approving
   * exactly `amount` if not. Returns the approval tx hash if one was sent.
   */
  async ensureAllowance(owner: Address, spender: Address, amount: bigint): Promise<Hex | undefined> {
    const current = await this.allowance(owner, spender);
    if (current >= amount) return undefined;
    return this.approve(spender, amount);
  }
}
