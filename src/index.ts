import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// 1. Initialize the modern McpServer
const mcp = new McpServer({
  name: "interactive-mcp-server",
  version: "1.0.0",
});

// 2. Define the Tool using the non-deprecated `registerTool` API
mcp.registerTool(
  "deploy_mission",
  {
    title: "Deploy mission",
    description:
      "Deploys a mission after explicit user confirmation in the client.",
    inputSchema: z.object({
      mission_name: z.string().describe("The name of the mission to deploy"),
    }),
  },
  async ({ mission_name }) => {
    try {
      // 3. THE FIX: Access the underlying low-level server via `mcp.server`
      // This bypasses the abstraction to send a raw JSON-RPC request back to Cursor.
      const response = await mcp.server.request(
        {
          method: "elicitation/create",
          params: {
            message: `⚠️ Authorization required: Click Confirm to deploy mission '${mission_name}'.`,
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
              text: `✅ SUCCESS: Mission '${mission_name}' has been deployed.`,
            },
          ],
        };
      }
      return {
        content: [{ type: "text", text: "❌ Deployment cancelled by user." }],
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
