import type {
  Account,
  Address,
  Hex,
  PublicClient,
  WalletClient,
} from "viem";

/**
 * Shared construction options for every Frontier client. A `PublicClient` is
 * always required for reads; a `WalletClient` is required only for write
 * helpers. The `account` is used when a WalletClient is configured without a
 * default account.
 */
export interface ClientOptions {
  publicClient: PublicClient;
  walletClient?: WalletClient;
  account?: Account | Address;
}

/** Base class that resolves the writing account and guards write paths. */
export abstract class FrontierClientBase {
  readonly publicClient: PublicClient;
  readonly walletClient?: WalletClient;
  protected readonly account?: Account | Address;

  constructor(opts: ClientOptions) {
    this.publicClient = opts.publicClient;
    this.walletClient = opts.walletClient;
    this.account = opts.account ?? opts.walletClient?.account;
  }

  /** Returns the wallet client or throws a clear error if not configured. */
  protected requireWallet(): WalletClient {
    if (!this.walletClient) {
      throw new Error(
        "This operation requires a WalletClient. Construct the client with { walletClient, account }.",
      );
    }
    return this.walletClient;
  }

  /** Resolves the account used to send transactions. */
  protected requireAccount(): Account | Address {
    const account = this.account ?? this.walletClient?.account;
    if (!account) {
      throw new Error(
        "No account configured. Pass { account } or use a WalletClient with a default account.",
      );
    }
    return account;
  }

  /**
   * Wait for a transaction receipt. Thin wrapper so callers can
   * `await client.waitForReceipt(hash)` without importing viem helpers.
   */
  async waitForReceipt(hash: Hex) {
    return this.publicClient.waitForTransactionReceipt({ hash });
  }
}
