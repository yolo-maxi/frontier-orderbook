import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { BookClient, PermissionClient, BOOK_SELECTORS, abi } from "@frontier/sdk";
import type { Address, Hex } from "viem";
import type { FrontierContext } from "../context.js";
import { resolveAddress } from "../context.js";
import { ok, guard } from "../result.js";
import { executeOrSimulate } from "../simulate.js";

const addr = z.string().regex(/^0x[0-9a-fA-F]{40}$/, "must be a 0x address");

export function registerPositionTools(server: McpServer, ctx: FrontierContext): void {
  const opts = { publicClient: ctx.publicClient, walletClient: ctx.walletClient, account: ctx.account };

  server.registerTool(
    "frontier_position_get",
    {
      title: "Read a position",
      description:
        "Read a position record plus live entitlements: owner, range, liquidity, side, claimableNet, and unfilled principal / refundable.",
      inputSchema: { book: addr.optional(), positionId: z.string() },
    },
    async ({ book, positionId }) =>
      guard(async () => {
        const bookAddr = resolveAddress(book, ctx.addresses.book, "book");
        const client = new BookClient(bookAddr, opts);
        const id = BigInt(positionId);
        const pos = await client.position(id);
        const entitlements = pos.isBid
          ? { claimableNet: await client.bidClaimable(id), refundable: await client.bidRefundable(id) }
          : { claimableNet: await client.claimable(id), unfilledPrincipal: await client.unfilledPrincipal(id) };
        return ok({ book: bookAddr, positionId: id, ...pos, ...entitlements });
      }),
  );

  server.registerTool(
    "frontier_position_transfer",
    {
      title: "Transfer a position",
      description: "Transfer ownership of a position to another address (owner or delegate only).",
      inputSchema: {
        book: addr.optional(),
        positionId: z.string(),
        to: addr,
        execute: z.boolean().default(false),
      },
    },
    async (a) =>
      guard(async () => {
        const bookAddr = resolveAddress(a.book, ctx.addresses.book, "book");
        const call = {
          address: bookAddr,
          abi: abi.geometricFrontierBookAbi as never,
          functionName: "transferPosition",
          args: [BigInt(a.positionId), a.to as Address] as const,
        };
        return ok(
          await executeOrSimulate(ctx, { action: "transferPosition", execute: a.execute, call }),
        );
      }),
  );

  server.registerTool(
    "frontier_delegation_grant",
    {
      title: "Grant maker-agent delegation",
      description:
        "Grant a bot selector-scoped permission over a book through PermissionRegistry, with an optional expiry (recommended). selectors can be named keys (claim, cancel, requote, claimBid, cancelBid, requoteBid, transferPosition, ...) or raw 0x selectors.",
      inputSchema: {
        registry: addr.optional(),
        operator: addr.describe("the agent/bot being authorized"),
        target: addr.describe("the book address"),
        selectors: z.array(z.string()).describe("named keys from BOOK_SELECTORS or raw 0x bytes4"),
        expiryUnix: z.number().int().positive().optional().describe("grant expiry; omit for no expiry"),
        execute: z.boolean().default(false),
      },
    },
    async (a) =>
      guard(async () => {
        const registry = resolveAddress(a.registry, ctx.addresses.registry, "registry");
        const resolved = a.selectors.map((s) => {
          if (/^0x[0-9a-fA-F]{8}$/.test(s)) return s as Hex;
          const v = (BOOK_SELECTORS as Record<string, string>)[s];
          if (!v) throw new Error(`unknown selector "${s}"; use a 0x bytes4 or a known name`);
          return v as Hex;
        });
        const perms = new PermissionClient(registry, opts);
        void perms; // typed helper available; we describe via raw call for simulation parity
        const expiry = BigInt(a.expiryUnix ?? 0);
        const call = {
          address: registry,
          abi: abi.permissionRegistryAbi as never,
          functionName: "grantSelectorBundle",
          args: [a.operator as Address, a.target as Address, resolved, expiry] as const,
        };
        return ok(
          await executeOrSimulate(ctx, {
            action: "grantSelectorBundle",
            execute: a.execute,
            call,
            extra: { selectors: resolved },
          }),
        );
      }),
  );

  server.registerTool(
    "frontier_delegation_check",
    {
      title: "Check delegation",
      description: "Read whether an operator may call a selector on a target for a user, plus the grant expiry.",
      inputSchema: {
        registry: addr.optional(),
        user: addr,
        operator: addr,
        target: addr,
        selector: z.string().describe("named key or raw 0x bytes4"),
      },
    },
    async (a) =>
      guard(async () => {
        const registry = resolveAddress(a.registry, ctx.addresses.registry, "registry");
        const selector = (
          /^0x[0-9a-fA-F]{8}$/.test(a.selector)
            ? a.selector
            : (BOOK_SELECTORS as Record<string, string>)[a.selector]
        ) as Hex | undefined;
        if (!selector) throw new Error(`unknown selector "${a.selector}"`);
        const perms = new PermissionClient(registry, opts);
        const authorized = await perms.isAuthorized(
          a.user as Address,
          a.operator as Address,
          a.target as Address,
          selector,
        );
        const expiry = await perms.expiryOf(a.user as Address, a.operator as Address, a.target as Address, selector);
        return ok({ authorized, expiry, selector });
      }),
  );
}
