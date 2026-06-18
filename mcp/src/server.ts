#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { buildContext } from "./context.js";
import { registerAllTools } from "./tools/index.js";

async function main(): Promise<void> {
  const ctx = buildContext();

  const server = new McpServer({
    name: "frontier-mcp",
    version: "0.1.0",
  });

  registerAllTools(server, ctx);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // stderr only: stdout is the JSON-RPC channel.
  const wallet = ctx.account ? `wallet=${ctx.account.address}` : "wallet=none (read/dry-run only)";
  process.stderr.write(`frontier-mcp ready on stdio (${wallet})\n`);
}

main().catch((err) => {
  process.stderr.write(`frontier-mcp failed to start: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
