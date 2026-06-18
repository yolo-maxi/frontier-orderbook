import { describe, it, expect } from "vitest";
import type { Abi, Address } from "viem";
import { executeAllowed, executeOrSimulate, ALLOW_EXECUTE_ENV } from "../src/simulate.js";
import { validateRpcUrl } from "../src/context.js";
import type { FrontierContext } from "../src/context.js";

const TEST_ABI = [
  {
    type: "function",
    name: "doThing",
    stateMutability: "nonpayable",
    inputs: [{ name: "x", type: "uint256" }],
    outputs: [{ name: "id", type: "uint256" }],
  },
] as const satisfies Abi;

const CALL = {
  address: "0x0000000000000000000000000000000000000abc" as Address,
  abi: TEST_ABI as unknown as Abi,
  functionName: "doThing",
  args: [1n] as const,
};

/** Build a fake context. `withWallet` toggles a configured wallet/account. */
function makeCtx(withWallet: boolean): FrontierContext {
  return {
    publicClient: {
      simulateContract: async () => ({ result: 42n }),
    } as any,
    walletClient: withWallet ? ({ writeContract: async () => "0xhash" } as any) : undefined,
    account: withWallet ? ({ address: "0x000000000000000000000000000000000000dEaD" } as any) : undefined,
    chain: undefined,
    addresses: {},
  } as FrontierContext;
}

describe("executeAllowed (safe-by-default gate)", () => {
  it("refuses when neither flag nor wallet is set", () => {
    const r = executeAllowed(makeCtx(false), {} as NodeJS.ProcessEnv);
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.reason).toMatch(ALLOW_EXECUTE_ENV);
  });

  it("refuses when a wallet is set but the opt-in flag is missing", () => {
    const r = executeAllowed(makeCtx(true), {} as NodeJS.ProcessEnv);
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.reason).toMatch(ALLOW_EXECUTE_ENV);
  });

  it("refuses when the flag is set but no wallet is configured", () => {
    const r = executeAllowed(makeCtx(false), { [ALLOW_EXECUTE_ENV]: "1" } as NodeJS.ProcessEnv);
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.reason).toMatch(/wallet/i);
  });

  it("allows only when both the flag is set AND a wallet is configured", () => {
    const ctx = makeCtx(true);
    expect(executeAllowed(ctx, { [ALLOW_EXECUTE_ENV]: "1" } as NodeJS.ProcessEnv).allowed).toBe(
      true,
    );
    expect(executeAllowed(ctx, { [ALLOW_EXECUTE_ENV]: "true" } as NodeJS.ProcessEnv).allowed).toBe(
      true,
    );
  });
});

describe("executeOrSimulate refusal default", () => {
  it("execute:true without opt-in does NOT broadcast and returns calldata + refusal", async () => {
    let broadcasts = 0;
    const ctx = {
      publicClient: { simulateContract: async () => ({ result: 42n }) },
      walletClient: {
        writeContract: async () => {
          broadcasts++;
          return "0xhash";
        },
      },
      account: { address: "0x000000000000000000000000000000000000dEaD" },
      chain: undefined,
      addresses: {},
    } as unknown as FrontierContext;

    // wallet configured but flag NOT set => must refuse.
    const prev = process.env[ALLOW_EXECUTE_ENV];
    delete process.env[ALLOW_EXECUTE_ENV];
    const out = await executeOrSimulate(ctx, { action: "doThing", execute: true, call: CALL });
    if (prev !== undefined) process.env[ALLOW_EXECUTE_ENV] = prev;

    expect(broadcasts).toBe(0);
    expect(out.executed).toBe(false);
    expect(out.dryRun).toBe(true);
    expect(out.refused).toMatch(ALLOW_EXECUTE_ENV);
    expect(out.calldata).toBeTypeOf("string");
    expect(out.hash).toBeUndefined();
  });

  it("execute:false returns a plain dry-run with no refusal flag", async () => {
    const ctx = {
      publicClient: { simulateContract: async () => ({ result: 7n }) },
      walletClient: undefined,
      account: undefined,
      chain: undefined,
      addresses: {},
    } as unknown as FrontierContext;

    const out = await executeOrSimulate(ctx, { action: "doThing", execute: false, call: CALL });
    expect(out.dryRun).toBe(true);
    expect(out.refused).toBeUndefined();
    expect(out.executed).toBeUndefined();
    expect(out.hash).toBeUndefined();
  });

  it("broadcasts only when both opt-in flag and wallet are present", async () => {
    let broadcasts = 0;
    const ctx = {
      publicClient: { simulateContract: async () => ({ result: 1n }) },
      walletClient: {
        writeContract: async () => {
          broadcasts++;
          return "0xdeadbeef";
        },
      },
      account: { address: "0x000000000000000000000000000000000000dEaD" },
      chain: undefined,
      addresses: {},
    } as unknown as FrontierContext;

    const prev = process.env[ALLOW_EXECUTE_ENV];
    process.env[ALLOW_EXECUTE_ENV] = "1";
    const out = await executeOrSimulate(ctx, { action: "doThing", execute: true, call: CALL });
    if (prev === undefined) delete process.env[ALLOW_EXECUTE_ENV];
    else process.env[ALLOW_EXECUTE_ENV] = prev;

    expect(broadcasts).toBe(1);
    expect(out.executed).toBe(true);
    expect(out.hash).toBe("0xdeadbeef");
    expect(out.dryRun).toBeUndefined();
  });
});

describe("validateRpcUrl (mcp)", () => {
  it("accepts http(s) and rejects others without leaking creds", () => {
    expect(validateRpcUrl("https://rpc.example.com/v2/key", "FRONTIER_RPC_URL")).toContain("https");
    expect(() => validateRpcUrl(undefined, "FRONTIER_RPC_URL")).toThrow(/required/);
    expect(() => validateRpcUrl("ws://localhost", "FRONTIER_RPC_URL")).toThrow(/http/);
    let msg = "";
    try {
      validateRpcUrl("ftp://user:SECRETPW@host", "FRONTIER_RPC_URL");
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).not.toContain("SECRETPW");
  });
});
