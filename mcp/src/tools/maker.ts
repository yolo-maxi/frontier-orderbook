import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { BookClient, abi, isTickAligned } from "@frontier/sdk";
import type { Address } from "viem";
import type { FrontierContext } from "../context.js";
import { resolveAddress } from "../context.js";
import { ok, guard, fail } from "../result.js";
import { executeOrSimulate } from "../simulate.js";

const addr = z.string().regex(/^0x[0-9a-fA-F]{40}$/, "must be a 0x address");
const bookAbi = abi.geometricFrontierBookAbi as never;

export function registerMakerTools(server: McpServer, ctx: FrontierContext): void {
  const opts = { publicClient: ctx.publicClient, walletClient: ctx.walletClient, account: ctx.account };

  server.registerTool(
    "frontier_maker_deposit",
    {
      title: "Place a maker order",
      description:
        "Place a resting maker order. side=ask sells token0 above current tick; side=bid buys token0 at/below current tick. Validates alignment and side, then simulates. Set execute:true to broadcast (token approval to the book must already be in place).",
      inputSchema: {
        book: addr.optional(),
        side: z.enum(["ask", "bid"]),
        lower: z.number().int(),
        upper: z.number().int(),
        liquidity: z.string().describe("liquidity as a base-unit integer string"),
        execute: z.boolean().default(false),
      },
    },
    async (a) =>
      guard(async () => {
        const bookAddr = resolveAddress(a.book, ctx.addresses.book, "book");
        const client = new BookClient(bookAddr, opts);
        const [spacing, current] = await Promise.all([client.tickSpacing(), client.currentTick()]);
        if (!isTickAligned(a.lower, spacing) || !isTickAligned(a.upper, spacing)) {
          return fail(`ticks must be aligned to spacing ${spacing}`);
        }
        if (a.lower >= a.upper) return fail("lower must be < upper");
        if (a.side === "ask" && a.lower < current) {
          return fail(`ask range must be above currentTick (${current})`);
        }
        if (a.side === "bid" && a.upper > current) {
          return fail(`bid range must be at or below currentTick (${current})`);
        }
        const fn = a.side === "ask" ? "deposit" : "depositBid";
        const call = {
          address: bookAddr,
          abi: bookAbi,
          functionName: fn,
          args: [a.lower, a.upper, BigInt(a.liquidity)] as const,
        };
        return ok(
          await executeOrSimulate(ctx, {
            action: fn,
            execute: a.execute,
            call,
            simFields: (sim) => ({ predictedPositionId: sim.result }),
          }),
        );
      }),
  );

  server.registerTool(
    "frontier_maker_claim",
    {
      title: "Claim maker proceeds",
      description:
        "Claim filled proceeds for a position (net of maker fee). side=ask returns token1, side=bid returns token0. Reads claimable first, then simulates/executes.",
      inputSchema: {
        book: addr.optional(),
        side: z.enum(["ask", "bid"]),
        positionId: z.string(),
        execute: z.boolean().default(false),
      },
    },
    async (a) =>
      guard(async () => {
        const bookAddr = resolveAddress(a.book, ctx.addresses.book, "book");
        const client = new BookClient(bookAddr, opts);
        const id = BigInt(a.positionId);
        const claimable = a.side === "ask" ? await client.claimable(id) : await client.bidClaimable(id);
        const fn = a.side === "ask" ? "claim" : "claimBid";
        const call = { address: bookAddr, abi: bookAbi, functionName: fn, args: [id] as const };
        return ok(
          await executeOrSimulate(ctx, {
            action: fn,
            execute: a.execute,
            call,
            extra: { claimableNet: claimable },
          }),
        );
      }),
  );

  server.registerTool(
    "frontier_maker_cancel",
    {
      title: "Cancel a maker order",
      description:
        "Cancel a position: returns filled proceeds plus unfilled principal/refund, and removes future eligibility. side=ask -> (proceeds1, principal0); side=bid -> (proceeds0, refund1).",
      inputSchema: {
        book: addr.optional(),
        side: z.enum(["ask", "bid"]),
        positionId: z.string(),
        execute: z.boolean().default(false),
      },
    },
    async (a) =>
      guard(async () => {
        const bookAddr = resolveAddress(a.book, ctx.addresses.book, "book");
        const fn = a.side === "ask" ? "cancel" : "cancelBid";
        const call = { address: bookAddr, abi: bookAbi, functionName: fn, args: [BigInt(a.positionId)] as const };
        return ok(await executeOrSimulate(ctx, { action: fn, execute: a.execute, call }));
      }),
  );

  server.registerTool(
    "frontier_maker_requote",
    {
      title: "Requote a maker order",
      description:
        "Move/resize a live position to a new range and liquidity. Requires owner or authorized delegate. side selects requote (ask) or requoteBid (bid).",
      inputSchema: {
        book: addr.optional(),
        side: z.enum(["ask", "bid"]),
        positionId: z.string(),
        newLower: z.number().int(),
        newUpper: z.number().int(),
        newLiquidity: z.string(),
        execute: z.boolean().default(false),
      },
    },
    async (a) =>
      guard(async () => {
        const bookAddr = resolveAddress(a.book, ctx.addresses.book, "book");
        const fn = a.side === "ask" ? "requote" : "requoteBid";
        const call = {
          address: bookAddr,
          abi: bookAbi,
          functionName: fn,
          args: [BigInt(a.positionId), a.newLower, a.newUpper, BigInt(a.newLiquidity)] as const,
        };
        return ok(await executeOrSimulate(ctx, { action: fn, execute: a.execute, call }));
      }),
  );
}
