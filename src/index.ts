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
      "Must be called BEFORE executing high-token tasks. Displays a formatted plan and cost to the user for explicit approval.\n\n" +
      "⚠️ CRITICAL FOR CURSOR/VSCODE USERS: When working in Cursor/VSCode, the IDE automatically loads MASSIVE context:\n" +
      "- Codebase search/index results: 30-80K+ tokens (automatic, happens on every task)\n" +
      "- Project structure and related files: 20-50K+ tokens (automatic)\n" +
      "- Editor state and open files: 10-30K+ tokens (automatic)\n" +
      "This means Cache Read tokens are OFTEN 50K-150K+ even for 'simple' tasks! Your explicit file reads are only PART of the total.\n\n" +
      "IMPORTANT: When estimating tokens, you MUST account for:\n" +
      "- Cache Read tokens: Your EXPLICIT file reads (estimate based on files you'll read: 5K-50K typically)\n" +
      "- IDE Context Overhead: AUTOMATIC context Cursor/VSCode loads (30K-80K+ for most tasks, separate from your explicit reads)\n" +
      "- Cache Write tokens: New code/content you'll generate (typically 5K-20K tokens for code generation, not just 1-10K)\n" +
      "- Input tokens: Direct prompt tokens (usually 0-5K)\n" +
      "- Output tokens: Generated response tokens (typically 1K-5K)\n" +
      "- Tool Call overhead: Each tool call adds ~1500 tokens (schema + request + response)\n" +
      "- Iterations: Multiple passes (analyze → read → generate → refine) multiply cache reads\n" +
      "- Context accumulation: Previous messages and tool responses stay in context (5K-20K tokens)\n\n" +
      "Guidelines for Cursor/VSCode:\n" +
      "- Small task: Cache Read 10K-30K (explicit) + IDE Context 30K-50K = 40K-80K total, 10-15 tool calls\n" +
      "- Medium task: Cache Read 30K-60K (explicit) + IDE Context 50K-80K = 80K-140K total, 15-25 tool calls\n" +
      "- Large task: Cache Read 60K-100K (explicit) + IDE Context 80K-120K = 140K-220K total, 25-50+ tool calls\n\n" +
      "Total = (Cache Read × Iterations) + IDE Context + Cache Write + Input + Output + (Tool Calls × 1500) + Context Accumulation",
    inputSchema: z.object({
      task_name: z
        .string()
        .describe(
          "A short, bold title for the task (e.g., 'Refactor Database')"
        ),
      pre_plan: z
        .string()
        .describe("A concise, bulleted summary of the steps you will take."),
      estimated_cache_read_tokens: z
        .number()
        .describe(
          "Estimated Cache Read tokens for YOUR EXPLICIT file reads (files you'll read via read_file, codebase_search, etc.). This is SEPARATE from IDE context overhead. Consider: How many files will you explicitly read? Small: 5K-20K, Medium: 20K-50K, Large: 50K-100K+."
        ),
      estimated_ide_context_overhead: z
        .number()
        .optional()
        .describe(
          "⚠️ CRITICAL FOR CURSOR/VSCODE: Estimated automatic IDE context overhead (codebase index, search results, project structure that Cursor/VSCode loads automatically). This is SEPARATE from your explicit file reads. Small projects: 30K-50K, Medium: 50K-80K, Large: 80K-120K+. Default: 50K (conservative estimate for most Cursor/VSCode tasks)."
        ),
      estimated_cache_write_tokens: z
        .number()
        .optional()
        .describe(
          "Estimated Cache Write tokens (new code/content to cache). Typically 5K-20K tokens for code generation tasks (not just 1-10K). Default: 0."
        ),
      estimated_input_tokens: z
        .number()
        .optional()
        .describe(
          "Estimated Input tokens (direct prompt, not cached). Usually 0-5K tokens. Default: 0."
        ),
      estimated_output_tokens: z
        .number()
        .optional()
        .describe(
          "Estimated Output tokens (generated response). Typically 1K-5K tokens. Default: 0."
        ),
      estimated_tool_calls: z
        .number()
        .optional()
        .describe(
          "Estimated number of tool calls you'll make during this task (file reads, searches, codebase searches, etc.). Each tool call adds ~1500 tokens overhead (schema + request + response). Small: 5-10, Medium: 10-20, Large: 20-50+. Default: 0."
        ),
      estimated_iterations: z
        .number()
        .optional()
        .describe(
          "Estimated number of conversation turns/iterations (e.g., analyze → read files → generate code → refine). Each iteration may re-read cache. Simple tasks: 1-2, Complex: 3-5, Very complex: 5+. Default: 1."
        ),
      estimated_context_accumulation: z
        .number()
        .optional()
        .describe(
          "Estimated additional tokens from context accumulation (previous messages, tool responses staying in context). Typically 5K-20K tokens. Default: 0."
        ),
      safety_multiplier: z
        .number()
        .optional()
        .describe(
          "Safety multiplier to account for unexpected overhead, tool call variations, and estimation uncertainty. 1.0 = no buffer, 1.5 = 50% buffer, 2.0 = 100% buffer. Recommended: 1.3-1.5 for well-planned tasks, 1.5-2.0 for exploratory tasks. Default: 1.3."
        ),
      estimated_tokens: z
        .string()
        .optional()
        .describe(
          "DEPRECATED: Use the breakdown fields above. Total estimated tokens as string (for display). If provided, will override calculated total."
        ),
      risk_level: z
        .enum(["LOW", "MEDIUM", "HIGH"])
        .describe("Risk level of high token used."),
    }),
  },
  async ({
    task_name,
    pre_plan,
    estimated_cache_read_tokens,
    estimated_ide_context_overhead = 50000, // Default 50K for Cursor/VSCode (conservative)
    estimated_cache_write_tokens = 0,
    estimated_input_tokens = 0,
    estimated_output_tokens = 0,
    estimated_tool_calls = 0,
    estimated_iterations = 1,
    estimated_context_accumulation = 0,
    safety_multiplier = 1.3,
    estimated_tokens,
    risk_level,
  }) => {
    try {
      // Constants
      const TOOL_CALL_OVERHEAD = 1500; // ~1500 tokens per tool call (schema + request + response)

      // Calculate base tokens (cache reads are multiplied by iterations since they may be re-read)
      const cacheReadTotal =
        estimated_cache_read_tokens * (estimated_iterations || 1);

      // Add IDE context overhead (this is automatic in Cursor/VSCode, separate from explicit reads)
      const ideContextOverhead = estimated_ide_context_overhead || 50000;

      const baseTokens =
        cacheReadTotal +
        ideContextOverhead + // IDE context is separate and doesn't multiply with iterations
        (estimated_cache_write_tokens || 0) +
        (estimated_input_tokens || 0) +
        (estimated_output_tokens || 0);

      // Add tool call overhead
      const toolCallOverhead = (estimated_tool_calls || 0) * TOOL_CALL_OVERHEAD;

      // Add context accumulation
      const contextAccumulation = estimated_context_accumulation || 0;

      // Calculate total before safety multiplier
      const totalBeforeMultiplier =
        baseTokens + toolCallOverhead + contextAccumulation;

      // Apply safety multiplier
      const finalMultiplier = safety_multiplier || 1.3;
      const totalTokens = Math.round(totalBeforeMultiplier * finalMultiplier);

      // Use provided string or calculate
      const displayTotal = estimated_tokens || totalTokens.toLocaleString();

      // Create detailed breakdown for display
      const tokenBreakdown = `Total: ${displayTotal} tokens
• Cache Read (explicit): ${estimated_cache_read_tokens.toLocaleString()} × ${estimated_iterations} iterations = ${cacheReadTotal.toLocaleString()} tokens
• IDE Context (automatic): ${ideContextOverhead.toLocaleString()} tokens
• Cache Write: ${(estimated_cache_write_tokens || 0).toLocaleString()} tokens
• Input: ${(estimated_input_tokens || 0).toLocaleString()} tokens
• Output: ${(estimated_output_tokens || 0).toLocaleString()} tokens
• Tool Calls: ${
        estimated_tool_calls || 0
      } × ${TOOL_CALL_OVERHEAD} = ${toolCallOverhead.toLocaleString()} tokens
• Context Accumulation: ${contextAccumulation.toLocaleString()} tokens
• Base Total: ${totalBeforeMultiplier.toLocaleString()} tokens
• Safety Multiplier: ${finalMultiplier}x
• Final Estimate: ${totalTokens.toLocaleString()} tokens`;

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
                  title: "💰 TOKEN BREAKDOWN (Read Only)",
                  enum: [tokenBreakdown], // <--- The Trick: Only one option
                  default: tokenBreakdown,
                },
                // 2. LOCK THE RISK
                risk_display: {
                  type: "string",
                  title: "🔥 RISK (Read Only)",
                  enum: [risk_level], // <--- The Trick
                  default: risk_level,
                },
                // 3. Show the plan
                plan_display: {
                  type: "string",
                  title: "📋 PLAN",
                  enum: [pre_plan],
                  default: pre_plan,
                },
              },
            },
          },
        },
        z.any()
      );

      const action = (response as any)?.action;

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
