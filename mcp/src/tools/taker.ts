import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { BookClient, LensClient, abi, applySlippage, deadlineFromNow } from "@frontier/sdk";
import type { Address } from "viem";
import type { FrontierContext } from "../context.js";
import { resolveAddress } from "../context.js";
import { ok, guard } from "../result.js";
import { broadcastWrite, simulateWrite } from "../simulate.js";

const addr = z.string().regex(/^0x[0-9a-fA-F]{40}$/, "must be a 0x address");
const routerAbi = abi.frontierRouterAbi as never;

export function registerTakerTools(server: McpServer, ctx: FrontierContext): void {
  const opts = { publicClient: ctx.publicClient, walletClient: ctx.walletClient, account: ctx.account };

  server.registerTool(
    "frontier_taker_swap",
    {
      title: "Take liquidity (router exact-in)",
      description:
        "Exact-input taker swap through FrontierRouter. Quotes via the lens, applies slippageBps to derive minOut (unless minOut is given), and simulates. Set execute:true to broadcast. Approve the input token (amountIn + taker fee) to the router first. direction=buy spends token1 for token0; direction=sell spends token0 for token1.",
      inputSchema: {
        book: addr.optional(),
        direction: z.enum(["buy", "sell"]),
        amountIn: z.string(),
        minOut: z.string().optional().describe("override auto slippage with an explicit minimum output"),
        slippageBps: z.number().int().min(0).max(10000).default(50),
        to: addr.optional().describe("recipient; defaults to the wallet account"),
        deadlineSeconds: z.number().int().positive().default(300),
        execute: z.boolean().default(false),
      },
    },
    async (a) =>
      guard(async () => {
        const router = resolveAddress(undefined, ctx.addresses.router, "router");
        const lens = new LensClient(resolveAddress(undefined, ctx.addresses.lens, "lens"), opts);
        const bookAddr = resolveAddress(a.book, ctx.addresses.book, "book");
        const amountIn = BigInt(a.amountIn);

        const quote =
          a.direction === "buy"
            ? await lens.quoteBuy(bookAddr, amountIn)
            : await lens.quoteSell(bookAddr, amountIn, 256n);
        const minOut = a.minOut ? BigInt(a.minOut) : applySlippage(quote.amountOut, a.slippageBps);

        const to = (a.to ?? ctx.account?.address) as Address | undefined;
        if (!to) {
          return ok({
            error:
              "No recipient: provide `to`, or configure FRONTIER_PRIVATE_KEY so the wallet account is used.",
          });
        }
        const deadline = deadlineFromNow(a.deadlineSeconds);
        const fn = a.direction === "buy" ? "buyExactIn" : "sellExactIn";
        const call = {
          address: router,
          abi: routerAbi,
          functionName: fn,
          args: [bookAddr, amountIn, minOut, to, deadline] as const,
        };
        if (!a.execute) {
          const sim = await simulateWrite(ctx, call);
          return ok({ action: fn, quote, minOut, dryRun: true, ...sim });
        }
        return ok({ action: fn, quote, minOut, executed: true, hash: await broadcastWrite(ctx, call) });
      }),
  );

  server.registerTool(
    "frontier_taker_sweep",
    {
      title: "Advanced direct sweep",
      description:
        "Advanced direct book sweep with explicit limits (target tick, maxFills, maxPay, minOut, deadline). For agents with their own quoting engine. target>currentTick buys token0; target<currentTick sells token0. Prefer frontier_taker_swap for normal swaps.",
      inputSchema: {
        book: addr.optional(),
        target: z.number().int(),
        maxFills: z.string().default("64"),
        maxPay: z.string(),
        minOut: z.string(),
        deadlineSeconds: z.number().int().positive().default(300),
        execute: z.boolean().default(false),
      },
    },
    async (a) =>
      guard(async () => {
        const bookAddr = resolveAddress(a.book, ctx.addresses.book, "book");
        const client = new BookClient(bookAddr, opts);
        const current = await client.currentTick();
        const deadline = deadlineFromNow(a.deadlineSeconds);
        const call = {
          address: bookAddr,
          abi: abi.geometricFrontierBookAbi as never,
          functionName: "sweepWithLimits",
          args: [a.target, BigInt(a.maxFills), BigInt(a.maxPay), BigInt(a.minOut), deadline] as const,
        };
        if (!a.execute) {
          const sim = await simulateWrite(ctx, call);
          return ok({ action: "sweepWithLimits", currentTick: current, dryRun: true, ...sim });
        }
        return ok({
          action: "sweepWithLimits",
          currentTick: current,
          executed: true,
          hash: await broadcastWrite(ctx, call),
        });
      }),
  );
}
