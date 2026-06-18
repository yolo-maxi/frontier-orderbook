import { encodeFunctionData, type Abi, type Address } from "viem";
import type { FrontierContext } from "./context.js";

/** Env flag that must be explicitly opted in to allow real broadcasts. */
export const ALLOW_EXECUTE_ENV = "FRONTIER_MCP_ALLOW_EXECUTE";

/**
 * Determine whether `execute: true` is permitted in this process.
 *
 * SAFE-BY-DEFAULT: broadcasting a signed transaction is refused unless BOTH
 *   1. the operator explicitly opted in via FRONTIER_MCP_ALLOW_EXECUTE=1, AND
 *   2. a wallet (FRONTIER_PRIVATE_KEY) is configured.
 * When either is missing we return a reason describing how to enable it so the
 * caller falls back to the (safe) simulation/calldata path instead.
 */
export function executeAllowed(
  ctx: FrontierContext,
  env: NodeJS.ProcessEnv = process.env,
): { allowed: true } | { allowed: false; reason: string } {
  const flag = env[ALLOW_EXECUTE_ENV];
  const optedIn = flag === "1" || flag?.toLowerCase() === "true";
  const hasWallet = Boolean(ctx.walletClient && ctx.account);

  if (!optedIn && !hasWallet) {
    return {
      allowed: false,
      reason:
        `Execution is disabled by default. Returning the simulation/calldata instead. ` +
        `To broadcast, set ${ALLOW_EXECUTE_ENV}=1 AND configure a wallet via FRONTIER_PRIVATE_KEY. ` +
        `Otherwise sign the returned calldata elsewhere.`,
    };
  }
  if (!optedIn) {
    return {
      allowed: false,
      reason:
        `Execution is disabled by default. Returning the simulation/calldata instead. ` +
        `A wallet is configured, but you must also set ${ALLOW_EXECUTE_ENV}=1 to opt in to broadcasting.`,
    };
  }
  if (!hasWallet) {
    return {
      allowed: false,
      reason:
        `${ALLOW_EXECUTE_ENV} is set, but no wallet is configured. Returning the simulation/calldata instead. ` +
        `Set FRONTIER_PRIVATE_KEY to enable execution, or sign the returned calldata elsewhere.`,
    };
  }
  return { allowed: true };
}

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

interface WriteCall {
  address: Address;
  abi: Abi;
  functionName: string;
  args: readonly unknown[];
}

/**
 * Unified safe write path used by every execute-capable tool.
 *
 * - `execute: false` (default): simulate and return calldata.
 * - `execute: true` but not allowed (see {@link executeAllowed}): REFUSE to
 *   broadcast, fall back to the simulation/calldata, and attach a `refused`
 *   message explaining how to enable execution. This is the safe-by-default
 *   behaviour the security audit requires.
 * - `execute: true` and allowed: broadcast and return the tx hash.
 *
 * `extra` fields are merged into every result; `simFields` lets a tool surface
 * simulation-derived values (e.g. predicted ids) only on the dry-run path.
 */
export async function executeOrSimulate(
  ctx: FrontierContext,
  opts: {
    action: string;
    execute: boolean;
    call: WriteCall;
    extra?: Record<string, unknown>;
    simFields?: (sim: SimOutcome) => Record<string, unknown>;
  },
): Promise<Record<string, unknown>> {
  const { action, execute, call, extra = {} } = opts;

  const wantsBroadcast = execute;
  const gate = executeAllowed(ctx);

  if (!wantsBroadcast || !gate.allowed) {
    const sim = await simulateWrite(ctx, call);
    const simExtra = opts.simFields ? opts.simFields(sim) : {};
    const base: Record<string, unknown> = { action, ...extra, ...simExtra, dryRun: true, ...sim };
    if (wantsBroadcast && !gate.allowed) {
      // Caller asked to execute but it was refused; make that explicit.
      base.executed = false;
      base.refused = gate.reason;
    }
    return base;
  }

  return { action, ...extra, executed: true, hash: await broadcastWrite(ctx, call) };
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
