/** MCP tool result helpers with BigInt-safe JSON serialization. */

export type ToolResult = {
  content: { type: "text"; text: string }[];
  isError?: boolean;
};

function replacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value;
}

export function ok(data: unknown): ToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(data, replacer, 2) }],
  };
}

export function fail(message: string): ToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify({ error: message }, replacer, 2) }],
    isError: true,
  };
}

/** Run an async handler and convert thrown errors into a tool error result. */
export async function guard(fn: () => Promise<ToolResult>): Promise<ToolResult> {
  try {
    return await fn();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return fail(msg);
  }
}
