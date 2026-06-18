import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { LensClient, BookClient } from "@frontier/sdk";
import type { FrontierContext } from "../context.js";
import { resolveAddress } from "../context.js";
import { ok, guard } from "../result.js";

const addr = z.string().regex(/^0x[0-9a-fA-F]{40}$/, "must be a 0x address");

export function registerLensTools(server: McpServer, ctx: FrontierContext): void {
  const opts = { publicClient: ctx.publicClient, walletClient: ctx.walletClient, account: ctx.account };

  server.registerTool(
    "frontier_book_config",
    {
      title: "Read book config",
      description:
        "Read a GeometricFrontierBook's full config: tokens, tickSpacing, currentTick, fee config, hooks, permissions registry.",
      inputSchema: { book: addr.optional().describe("book address; defaults to FRONTIER_BOOK") },
    },
    async ({ book }) =>
      guard(async () => {
        const address = resolveAddress(book, ctx.addresses.book, "book");
        const client = new BookClient(address, opts);
        return ok(await client.config());
      }),
  );

  server.registerTool(
    "frontier_lens_summary",
    {
      title: "Book summary",
      description:
        "FrontierLens.summary: currentTick, tickSpacing, tokens, best ask and best bid within a scan window.",
      inputSchema: {
        book: addr.optional(),
        scanWindow: z.number().int().positive().default(10_000).describe("tick scan window"),
      },
    },
    async ({ book, scanWindow }) =>
      guard(async () => {
        const lens = new LensClient(resolveAddress(undefined, ctx.addresses.lens, "lens"), opts);
        const bookAddr = resolveAddress(book, ctx.addresses.book, "book");
        return ok(await lens.summary(bookAddr, scanWindow));
      }),
  );

  server.registerTool(
    "frontier_lens_depth",
    {
      title: "Book depth",
      description: "FrontierLens.depth: aggregated bid/ask liquidity levels between two ticks.",
      inputSchema: {
        book: addr.optional(),
        fromTick: z.number().int(),
        toTick: z.number().int(),
        maxLevels: z.number().int().positive().max(1000).default(200),
      },
    },
    async ({ book, fromTick, toTick, maxLevels }) =>
      guard(async () => {
        const lens = new LensClient(resolveAddress(undefined, ctx.addresses.lens, "lens"), opts);
        const bookAddr = resolveAddress(book, ctx.addresses.book, "book");
        const levels = await lens.depth(bookAddr, fromTick, toTick, BigInt(maxLevels));
        return ok({ book: bookAddr, levels });
      }),
  );

  server.registerTool(
    "frontier_quote",
    {
      title: "Quote a swap",
      description:
        "Quote a taker swap through FrontierLens before trading. Returns amountOut, amountSpent and endTick. Use this, apply slippage, then call frontier_taker_swap.",
      inputSchema: {
        book: addr.optional(),
        direction: z.enum(["buy", "sell"]).describe("buy = token1->token0, sell = token0->token1"),
        amountIn: z.string().describe("input amount as a base-unit integer string"),
        maxRuns: z.string().optional().describe("sell only: bound the quote scan; default 256"),
      },
    },
    async ({ book, direction, amountIn, maxRuns }) =>
      guard(async () => {
        const lens = new LensClient(resolveAddress(undefined, ctx.addresses.lens, "lens"), opts);
        const bookAddr = resolveAddress(book, ctx.addresses.book, "book");
        const amt = BigInt(amountIn);
        const quote =
          direction === "buy"
            ? await lens.quoteBuy(bookAddr, amt)
            : await lens.quoteSell(bookAddr, amt, maxRuns ? BigInt(maxRuns) : 256n);
        return ok({ book: bookAddr, direction, amountIn: amt, ...quote });
      }),
  );
}
