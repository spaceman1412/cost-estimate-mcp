import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// 1. Initialize the server
const mcp = new McpServer({
  name: "cost-estimate-mcp",
  version: "1.1.0",
});

// 2. Define the Tool
mcp.registerTool(
  "estimate_cost",
  {
    title: "Cost and Token Gatekeeper",
    description:
      "Must be called BEFORE executing high-token tasks. Displays a formatted plan and cost to the user for explicit approval.",
    inputSchema: z.object({
      task_name: z
        .string()
        .describe(
          "A short, bold title for the task (e.g., 'Refactor Database')"
        ),
      pre_plan: z
        .string()
        .describe("A concise, bulleted summary of the steps you will take."),
      estimated_tokens: z
        .string()
        .describe(
          "Estimated input/output token usage (e.g., 'Input: 5k, Output: 2k')."
        ),
      risk_level: z
        .enum(["LOW", "MEDIUM", "HIGH"])
        .describe("Assessment of complexity or potential side effects."),
    }),
  },
  async ({ task_name, pre_plan, estimated_tokens, risk_level }) => {
    try {
      // 3. Send request to Client (Cursor)
      const response = await mcp.server.request(
        {
          method: "elicitation/create",
          params: {
            // 1. Keep the main message short
            message: `⚠️ Review Plan for: ${task_name}`,

            // 2. Use the schema to display the data as "Form Fields"
            requestedSchema: {
              type: "object",
              properties: {
                // 1. LOCK THE COST: User sees this, but can't change it
                cost_display: {
                  type: "string",
                  title: "💰 COST (Read Only)",
                  enum: [estimated_tokens], // <--- The Trick: Only one option
                  default: estimated_tokens,
                },
                // 2. LOCK THE RISK
                risk_display: {
                  type: "string",
                  title: "🔥 RISK (Read Only)",
                  enum: [risk_level], // <--- The Trick
                  default: risk_level,
                },
              },
            },
          },
        },
        z.any()
      );

      const action = (response as any)?.action;
      const userDecision = (response as any)?.content?.user_decision;

      // 4. IMPROVEMENT: Stricter Control Flow Messages
      if (action === "accept") {
        return {
          content: [
            {
              type: "text",
              text: `[SYSTEM: USER_APPROVED]\nAuthorization granted for task: "${task_name}".\n\nIMMEDIATE ACTION: Proceed with the execution of the plan described above. Do not ask for further confirmation. Start generating code/text now.`,
            },
          ],
        };
      }

      // Handle Rejection
      return {
        content: [
          {
            type: "text",
            text: `[SYSTEM: USER_REJECTED]\nThe user denied the plan for "${task_name}". Stop immediately. Ask the user for feedback on how to adjust the plan.`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Middleware Error: ${error}` }],
        isError: true,
      };
    }
  }
);

// 5. Connect transport
async function main() {
  const transport = new StdioServerTransport();
  await mcp.connect(transport);
  console.error("Cost Estimate MCP Server running on stdio");
}

main();
