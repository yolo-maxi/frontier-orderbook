import { encodeFunctionData, type Abi, type Address } from "viem";
import type { FrontierContext } from "./context.js";

export interface SimOutcome {
  simulated: boolean;
  /** Decoded simulation return value, if the call is non-view and succeeds. */
  result?: unknown;
  /** Encoded calldata for the prepared transaction. */
  calldata: `0x${string}`;
  to: Address;
  /** Whether a wallet is configured to actually broadcast. */
  canExecute: boolean;
  note?: string;
}

/**
 * Simulate a contract write via eth_call (`simulateContract`) without
 * broadcasting, and always return the encoded calldata so a caller without a
 * configured wallet can sign elsewhere.
 */
export async function simulateWrite(
  ctx: FrontierContext,
  args: {
    address: Address;
    abi: Abi;
    functionName: string;
    args: readonly unknown[];
  },
): Promise<SimOutcome> {
  const calldata = encodeFunctionData({
    abi: args.abi,
    functionName: args.functionName,
    args: args.args as never,
  });

  const account = ctx.account?.address;
  let simulated = false;
  let result: unknown;
  let note: string | undefined;

  try {
    const sim = await ctx.publicClient.simulateContract({
      address: args.address,
      abi: args.abi,
      functionName: args.functionName as never,
      args: args.args as never,
      account,
    });
    simulated = true;
    result = sim.result;
  } catch (err) {
    note = `simulation reverted: ${err instanceof Error ? err.message.split("\n")[0] : String(err)}`;
  }

  return {
    simulated,
    result,
    calldata,
    to: args.address,
    canExecute: Boolean(ctx.walletClient),
    note,
  };
}

/** Broadcast a previously-described write. */
export async function broadcastWrite(
  ctx: FrontierContext,
  args: {
    address: Address;
    abi: Abi;
    functionName: string;
    args: readonly unknown[];
  },
): Promise<`0x${string}`> {
  if (!ctx.walletClient || !ctx.account) {
    throw new Error(
      "No wallet configured. Set FRONTIER_PRIVATE_KEY to enable execution, or use the calldata from the dry run to sign elsewhere.",
    );
  }
  return ctx.walletClient.writeContract({
    chain: ctx.chain,
    account: ctx.account,
    address: args.address,
    abi: args.abi,
    functionName: args.functionName as never,
    args: args.args as never,
  });
}
