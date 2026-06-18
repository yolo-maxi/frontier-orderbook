import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MarketCreator, abi } from "@frontier/sdk";
import { zeroAddress, type Address } from "viem";
import type { FrontierContext } from "../context.js";
import { resolveAddress } from "../context.js";
import { ok, guard } from "../result.js";
import { broadcastWrite, simulateWrite } from "../simulate.js";

const addr = z.string().regex(/^0x[0-9a-fA-F]{40}$/, "must be a 0x address");

export function registerMarketTools(server: McpServer, ctx: FrontierContext): void {
  const opts = { publicClient: ctx.publicClient, walletClient: ctx.walletClient, account: ctx.account };

  server.registerTool(
    "frontier_market_find",
    {
      title: "Find a market",
      description:
        "Look up an existing GeometricFrontierBook for a token pair via the factory (defaultBook + spacing-specific getBook).",
      inputSchema: {
        token0: addr,
        token1: addr,
        tickSpacing: z.number().int().positive().optional(),
        factory: addr.optional(),
      },
    },
    async ({ token0, token1, tickSpacing, factory }) =>
      guard(async () => {
        const creator = new MarketCreator(
          resolveAddress(factory, ctx.addresses.factory, "factory"),
          opts,
        );
        const out: Record<string, unknown> = {
          defaultBook: await creator.defaultBook(token0 as Address, token1 as Address),
          bookCount: await creator.bookCount(),
        };
        if (tickSpacing) {
          out.bookForSpacing = await creator.getBook(token0 as Address, token1 as Address, tickSpacing);
        }
        return ok(out);
      }),
  );

  server.registerTool(
    "frontier_market_create",
    {
      title: "Create a market",
      description:
        "Create a GeometricFrontierBook through the factory. Validates params client-side, then simulates. Pass execute:true (with a configured wallet) to broadcast. Zero fees use createGeoBook; non-zero fees use createGeoBookWithFees and require a feeRecipient.",
      inputSchema: {
        token0: addr,
        token1: addr,
        tickSpacing: z.number().int().positive(),
        startTick: z.number().int(),
        feeRecipient: addr.optional(),
        makerFeeBps: z.number().int().min(0).max(1000).default(0),
        takerFeeBps: z.number().int().min(0).max(1000).default(0),
        factory: addr.optional(),
        execute: z.boolean().default(false).describe("broadcast instead of dry-run"),
      },
    },
    async (a) =>
      guard(async () => {
        const params = {
          token0: a.token0 as Address,
          token1: a.token1 as Address,
          tickSpacing: a.tickSpacing,
          startTick: a.startTick,
          feeRecipient: a.feeRecipient as Address | undefined,
          makerFeeBps: a.makerFeeBps,
          takerFeeBps: a.takerFeeBps,
        };
        MarketCreator.validate(params);
        const factory = resolveAddress(a.factory, ctx.addresses.factory, "factory");
        const zeroFee = a.makerFeeBps === 0 && a.takerFeeBps === 0 && !a.feeRecipient;
        const call = zeroFee
          ? {
              address: factory,
              abi: abi.frontierGeoBookFactoryAbi as never,
              functionName: "createGeoBook",
              args: [params.token0, params.token1, params.tickSpacing, params.startTick] as const,
            }
          : {
              address: factory,
              abi: abi.frontierGeoBookFactoryAbi as never,
              functionName: "createGeoBookWithFees",
              args: [
                params.token0,
                params.token1,
                params.tickSpacing,
                params.startTick,
                params.feeRecipient ?? zeroAddress,
                a.makerFeeBps,
                a.takerFeeBps,
              ] as const,
            };

        if (!a.execute) {
          const sim = await simulateWrite(ctx, call);
          return ok({ action: "createMarket", dryRun: true, predictedBook: sim.result, ...sim });
        }
        const hash = await broadcastWrite(ctx, call);
        return ok({ action: "createMarket", executed: true, hash });
      }),
  );
}
