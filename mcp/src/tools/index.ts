import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { FrontierContext } from "../context.js";
import { registerLensTools } from "./lens.js";
import { registerMarketTools } from "./market.js";
import { registerMakerTools } from "./maker.js";
import { registerTakerTools } from "./taker.js";
import { registerPositionTools } from "./position.js";

export function registerAllTools(server: McpServer, ctx: FrontierContext): void {
  registerLensTools(server, ctx);
  registerMarketTools(server, ctx);
  registerMakerTools(server, ctx);
  registerTakerTools(server, ctx);
  registerPositionTools(server, ctx);
}
