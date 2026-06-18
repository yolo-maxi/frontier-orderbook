import type { Address, Hex } from "viem";
import { permissionRegistryAbi } from "../abi/PermissionRegistry.js";
import { FrontierClientBase, type ClientOptions } from "./base.js";

/**
 * Selector-scoped delegation through `PermissionRegistry`. Prefer
 * {@link grantBundle} with an expiry over {@link grantFull}.
 */
export class PermissionClient extends FrontierClientBase {
  readonly registry: Address;

  constructor(registry: Address, opts: ClientOptions) {
    super(opts);
    this.registry = registry;
  }

  private write<const F extends string>(functionName: F, args: readonly unknown[]): Promise<Hex> {
    const wallet = this.requireWallet();
    return wallet.writeContract({
      chain: wallet.chain,
      account: this.requireAccount(),
      address: this.registry,
      abi: permissionRegistryAbi,
      functionName: functionName as never,
      args: args as never,
    });
  }

  /** Grant a single selector with no expiry. */
  grant(operator: Address, target: Address, selector: Hex): Promise<Hex> {
    return this.write("grant", [operator, target, selector]);
  }

  /** Grant a single selector that auto-expires at `expiry` (unix seconds). */
  grantWithExpiry(operator: Address, target: Address, selector: Hex, expiry: bigint): Promise<Hex> {
    return this.write("grantWithExpiry", [operator, target, selector, expiry]);
  }

  /** Grant a bundle of selectors that all expire at `expiry`. */
  grantBundle(operator: Address, target: Address, selectors: readonly Hex[], expiry: bigint): Promise<Hex> {
    return this.write("grantSelectorBundle", [operator, target, selectors, expiry]);
  }

  /** Grant every selector on a target. Use only for trusted automation. */
  grantFull(operator: Address, target: Address): Promise<Hex> {
    return this.write("grantFull", [operator, target]);
  }

  revoke(operator: Address, target: Address, selector: Hex): Promise<Hex> {
    return this.write("revoke", [operator, target, selector]);
  }

  revokeAll(operator: Address, target: Address): Promise<Hex> {
    return this.write("revokeAll", [operator, target]);
  }

  /** Read whether `operator` may call `selector` on `target` for `user`. */
  async isAuthorized(user: Address, operator: Address, target: Address, selector: Hex): Promise<boolean> {
    return this.publicClient.readContract({
      address: this.registry,
      abi: permissionRegistryAbi,
      functionName: "isAuthorizedCall",
      args: [user, operator, target, selector],
    });
  }

  /** Read the expiry timestamp for a grant (0 = none). */
  async expiryOf(user: Address, operator: Address, target: Address, selector: Hex): Promise<number> {
    return this.publicClient.readContract({
      address: this.registry,
      abi: permissionRegistryAbi,
      functionName: "permissionExpiry",
      args: [user, operator, target, selector],
    });
  }
}
