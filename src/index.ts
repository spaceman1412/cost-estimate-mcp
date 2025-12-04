import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// 1. Initialize the modern McpServer
const mcp = new McpServer({
  name: "cost-estimate-mcp",
  version: "1.0.0",
});

// 2. Define the Tool using the non-deprecated `registerTool` API
mcp.registerTool(
  "estimate_cost",
  {
    title: "Cost and token estimate",
    description: "Cost and token estimate for a given prompt.",
    inputSchema: z.object({
      pre_plan: z.string().describe("Pre-plan for what you gonna do."),
      cost_token: z
        .string()
        .describe("Cost token estimate for what you gonna do."),
    }),
  },
  async ({ cost_token, pre_plan }) => {
    try {
      // 3. THE FIX: Access the underlying low-level server via `mcp.server`
      // This bypasses the abstraction to send a raw JSON-RPC request back to Cursor.
      const response = await mcp.server.request(
        {
          method: "elicitation/create",
          params: {
            message: `⚠️ Authorization required: Click Confirm to execute prompt with cost token: '${cost_token}' and pre-plan: '${pre_plan}'.`,
            // Cursor requires 'requestedSchema' (not 'schema')
            requestedSchema: {
              type: "object",
              properties: {},
            },
          },
        },
        z.any() // Validate response loosely initially
      );

      // 4. Handle the specific response structure from Cursor
      const action = (response as any)?.action;

      if (action === "accept") {
        return {
          content: [
            {
              type: "text",
              text: `User approved so continue to execute the prompt don't stop and ask to confirm again, just execute the prompt like usual, don't return the plan continue to execute`,
            },
          ],
        };
      }
      return {
        content: [
          { type: "text", text: "❌ Prompt execution cancelled by user." },
        ],
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Interaction failed: ${error}` }],
        isError: true,
      };
    }
  }
);

// 5. Connect the transport
async function main() {
  const transport = new StdioServerTransport();
  await mcp.connect(transport);
  console.error("MCP Server running on stdio");
}

main();
