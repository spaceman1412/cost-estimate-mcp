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
      "🚨 CRITICAL TIMING - DO NOT CALL TOO EARLY!\n\n" +
      "❌ DO NOT CALL if:\n" +
      "- You're still exploring the codebase or thinking about the approach\n" +
      "- Your plan is vague or incomplete (e.g., 'I'll read some files and refactor')\n" +
      "- You haven't decided which specific files you'll read\n" +
      "- You're not sure how many tool calls you'll make\n" +
      "- You haven't thought through the iterations/cycles needed\n" +
      "- Your pre_plan is generic and doesn't match what you'll actually do\n" +
      "- You're still in the 'thinking' or 'exploring' phase\n\n" +
      "✅ ONLY CALL when ALL of these are TRUE:\n" +
      "1. ✅ You have a DETAILED, SPECIFIC plan (not vague)\n" +
      "2. ✅ You know EXACTLY which files you'll read (can list them or estimate count)\n" +
      "3. ✅ You know EXACTLY which tools you'll use (codebase_search, read_file, etc.)\n" +
      "4. ✅ You know EXACTLY how many tool calls you'll make (count them)\n" +
      "5. ✅ You know EXACTLY how many iterations you'll need (be realistic)\n" +
      "6. ✅ Your pre_plan accurately describes what you'll ACTUALLY do\n" +
      "7. ✅ You've finished ALL thinking/planning and are ready to execute\n\n" +
      "⚠️ VALIDATION CHECK before calling:\n" +
      "Ask yourself: 'If I execute my pre_plan exactly as written, will it match what I actually do?'\n" +
      "If NO → Your plan isn't ready. Wait and plan more.\n" +
      "If YES → You can call this tool.\n\n" +
      "EXAMPLES:\n" +
      "❌ TOO EARLY: 'I'll search the codebase and refactor some components' (too vague, no specifics)\n" +
      "✅ READY: 'I'll use codebase_search 3 times to find duplicate code, read 15 files, create 2 shared components, update 8 files to use them, verify in 3 iterations' (specific, detailed)\n\n" +
      "The pre_plan you provide MUST be detailed enough that someone else could execute it. If it's vague, you're calling too early.\n\n" +
      "❌ TOO LATE: If you've already started reading files → Too late, tokens already spent\n\n" +
      "Must be called BEFORE executing high-token tasks. Displays a formatted plan and cost to the user for explicit approval.\n\n" +
      "⚠️ CRITICAL FOR CURSOR/VSCODE USERS: When working in Cursor/VSCode, the IDE automatically loads MASSIVE context:\n" +
      "- Codebase search/index results: 30-80K+ tokens (automatic, happens on every task)\n" +
      "- Project structure and related files: 20-50K+ tokens (automatic)\n" +
      "- Editor state and open files: 10-30K+ tokens (automatic)\n" +
      "This means Cache Read tokens are OFTEN 50K-150K+ even for 'simple' tasks! Your explicit file reads are only PART of the total.\n\n" +
      "⚠️ CRITICAL: REFACTORING and CODEBASE_SEARCH tasks are MUCH more expensive!\n" +
      "- codebase_search: Each call can read 50K-200K+ tokens (reads many related files)\n" +
      "- Refactoring tasks: Often require 200K-600K+ total cache reads (many searches + file reads)\n" +
      "- If you're refactoring or searching the codebase, multiply your estimates by 5-10x!\n\n" +
      "IMPORTANT: When estimating tokens, you MUST account for:\n" +
      "- Cache Read tokens: Your EXPLICIT file reads. ⚠️ If using codebase_search, each search reads 50K-200K+ tokens! For refactoring: 200K-600K+ total. For simple edits: 5K-50K.\n" +
      "- IDE Context Overhead: AUTOMATIC context Cursor/VSCode loads (30K-80K+ for most tasks, separate from your explicit reads)\n" +
      "- Cache Write tokens: New code/content you'll generate (typically 10K-100K+ tokens for refactoring, 5K-20K for simple edits)\n" +
      "- Input tokens: Direct prompt tokens (usually 0-5K)\n" +
      "- Output tokens: Generated response tokens (typically 1K-10K tokens)\n" +
      "- Tool Call overhead: Each tool call adds ~1500 tokens (schema + request + response)\n" +
      "- Iterations: Multiple passes multiply cache reads. ⚠️ Refactoring tasks often have 5-15 iterations (read → modify → verify cycles)\n" +
      "- Context accumulation: Previous messages and tool responses stay in context (10K-50K+ tokens for long tasks)\n\n" +
      "Guidelines for Cursor/VSCode:\n" +
      "- Simple edit (few files): Cache Read 10K-30K (explicit) + IDE Context 30K-50K = 40K-80K total, 10-15 tool calls, 1-2 iterations\n" +
      "- Multi-file edit: Cache Read 30K-100K (explicit) + IDE Context 50K-80K = 80K-180K total, 15-30 tool calls, 2-4 iterations\n" +
      "- Refactoring/Search: Cache Read 200K-600K+ (explicit) + IDE Context 80K-120K = 280K-720K+ total, 30-80+ tool calls, 5-15 iterations\n\n" +
      "Total = (Cache Read × Iterations) + IDE Context + Cache Write + Input + Output + (Tool Calls × 1500) + Context Accumulation",
    inputSchema: z.object({
      task_name: z
        .string()
        .describe(
          "A short, bold title for the task (e.g., 'Refactor Database')"
        ),
      pre_plan: z
        .string()
        .describe(
          "⚠️ CRITICAL: A DETAILED, SPECIFIC plan that accurately describes EXACTLY what you will do. This must be your FINAL plan, not a rough draft.\n\n" +
            "Your pre_plan should include:\n" +
            "- Specific tools you'll use (e.g., '3 codebase_search calls', 'read 15 files', 'create 2 components')\n" +
            "- Specific files/components you'll work with (if known)\n" +
            "- The sequence of steps you'll take\n" +
            "- How many iterations you expect\n\n" +
            "If your plan is vague (e.g., 'I'll refactor some code'), you're calling too early. Wait until you have a detailed plan.\n\n" +
            "This plan will be shown to the user, so it must be accurate and match what you'll actually execute."
        ),
      estimated_cache_read_tokens: z
        .number()
        .describe(
          "⚠️ CRITICAL: Estimated Cache Read tokens for YOUR EXPLICIT file reads. This is SEPARATE from IDE context overhead.\n\n" +
            "IMPORTANT GUIDELINES:\n" +
            "- codebase_search: Each call reads 50K-200K+ tokens (reads many related files automatically)\n" +
            "- read_file: Each file is 1K-5K tokens\n" +
            "- grep/search: 5K-20K tokens per search\n\n" +
            "For REFACTORING tasks (sharing code, extracting components, etc.):\n" +
            "- You'll likely make 3-10 codebase_search calls = 150K-2000K+ tokens\n" +
            "- Plus reading 10-50 files = 10K-250K tokens\n" +
            "- Total often: 200K-600K+ tokens\n\n" +
            "For SIMPLE edits (modifying a few files):\n" +
            "- Reading 1-5 files: 5K-25K tokens\n" +
            "- No codebase_search: 0K\n" +
            "- Total: 5K-50K tokens\n\n" +
            "Be HONEST: If you're doing refactoring or using codebase_search, estimate 200K-600K+. If just editing files, 5K-50K."
        ),
      estimated_ide_context_overhead: z
        .number()
        .optional()
        .describe(
          "⚠️ CRITICAL FOR CURSOR/VSCODE: Estimated automatic IDE context overhead (codebase index, search results, project structure that Cursor/VSCode loads automatically). This is SEPARATE from your explicit file reads. Small projects: 30K-50K, Medium: 50K-80K, Large: 80K-120K+. Default: 60K (based on actual usage patterns for most Cursor/VSCode tasks)."
        ),
      estimated_cache_write_tokens: z
        .number()
        .optional()
        .describe(
          "Estimated Cache Write tokens (new code/content to cache).\n\n" +
            "GUIDELINES:\n" +
            "- Simple edit: 5K-20K tokens\n" +
            "- Multi-file edit: 10K-50K tokens\n" +
            "- Refactoring: 50K-150K+ tokens (creates new files, utilities, components)\n\n" +
            "For refactoring tasks, you're often creating new shared components/utilities, so cache writes are much higher. Default: 0."
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
          "Estimated number of tool calls you'll make during this task.\n\n" +
            "GUIDELINES:\n" +
            "- Simple edit: 5-15 tool calls\n" +
            "- Multi-file edit: 15-30 tool calls\n" +
            "- Refactoring: 30-80+ tool calls (many searches, reads, writes, verifications)\n\n" +
            "Each tool call adds ~1500 tokens overhead (schema + request + response). For refactoring, count ALL your tool calls: codebase_search (3-10), read_file (10-50), write/edit (5-20), verify (5-10). Default: 0."
        ),
      estimated_iterations: z
        .number()
        .optional()
        .describe(
          "⚠️ CRITICAL: Estimated number of conversation turns/iterations. Each iteration re-reads cache, multiplying your costs!\n\n" +
            "GUIDELINES:\n" +
            "- Simple edit: 1-2 iterations (read → modify → done)\n" +
            "- Multi-file edit: 2-4 iterations (read → modify → verify → fix)\n" +
            "- Refactoring: 5-15 iterations (many read → modify → verify → read more → fix cycles)\n" +
            "- Codebase search tasks: 3-8 iterations\n\n" +
            "If you're doing refactoring, you'll likely have MANY iterations as you discover dependencies and need to read more files. Be realistic: refactoring often has 8-15 iterations. Default: 1."
        ),
      estimated_context_accumulation: z
        .number()
        .optional()
        .describe(
          "Estimated additional tokens from context accumulation (previous messages, tool responses staying in context).\n\n" +
            "GUIDELINES:\n" +
            "- Simple task: 5K-20K tokens\n" +
            "- Refactoring/long task: 20K-100K+ tokens (many tool responses accumulate)\n\n" +
            "For refactoring tasks with many iterations, context accumulation can be very high. Default: 0."
        ),
      safety_multiplier: z
        .number()
        .optional()
        .describe(
          "Safety multiplier to account for unexpected overhead, tool call variations, and estimation uncertainty. 1.0 = no buffer, 1.5 = 50% buffer, 2.0 = 100% buffer. Recommended: 1.3-1.5 for well-planned tasks, 1.5-2.0 for exploratory tasks. Default: 1.5 (increased for better accuracy based on usage patterns)."
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
    estimated_ide_context_overhead = 60000, // Default 60K for Cursor/VSCode (based on actual usage patterns)
    estimated_cache_write_tokens = 0,
    estimated_input_tokens = 0,
    estimated_output_tokens = 0,
    estimated_tool_calls = 0,
    estimated_iterations = 1,
    estimated_context_accumulation = 0,
    safety_multiplier = 1.5, // Increased default from 1.3 to 1.5 for better accuracy
    estimated_tokens,
    risk_level,
  }) => {
    try {
      // Constants
      const TOOL_CALL_OVERHEAD = 1500; // ~1500 tokens per tool call (schema + request + response)

      // Detect if this is a refactoring/search task based on keywords
      const taskNameLower = task_name.toLowerCase();
      const prePlanLower = pre_plan.toLowerCase();
      const isRefactoringTask =
        taskNameLower.includes("refactor") ||
        taskNameLower.includes("refactoring") ||
        taskNameLower.includes("extract") ||
        taskNameLower.includes("share") ||
        taskNameLower.includes("common") ||
        taskNameLower.includes("duplicate") ||
        prePlanLower.includes("codebase_search") ||
        prePlanLower.includes("codebase search") ||
        prePlanLower.includes("search the codebase");

      // Apply refactoring multiplier if detected and estimates seem low
      let refactoringMultiplier = 1.0;
      let refactoringWarning = "";
      if (isRefactoringTask) {
        // If it's a refactoring task but estimates are low, apply multiplier
        if (estimated_cache_read_tokens < 100000) {
          refactoringMultiplier = 3.0; // Refactoring tasks typically read 3-5x more
          refactoringWarning =
            "\n⚠️ REFACTORING DETECTED: Your cache read estimate seems low for a refactoring task. Applied 3x multiplier.";
        }
      }

      // Calculate base tokens (cache reads are multiplied by iterations since they may be re-read)
      const cacheReadTotal =
        estimated_cache_read_tokens *
        refactoringMultiplier *
        (estimated_iterations || 1);

      // Add IDE context overhead (this is automatic in Cursor/VSCode, separate from explicit reads)
      // Note: IDE context typically loads once per task, not per iteration
      const ideContextOverhead = estimated_ide_context_overhead || 60000;

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

      // Apply safety multiplier (increased default to 1.5 for better accuracy)
      const finalMultiplier = safety_multiplier || 1.5;
      const totalTokens = Math.round(totalBeforeMultiplier * finalMultiplier);

      // Use provided string or calculate
      const displayTotal = estimated_tokens || totalTokens.toLocaleString();

      // Create detailed breakdown for display
      const refactoringNote =
        refactoringMultiplier > 1.0
          ? ` (${refactoringMultiplier}x refactoring multiplier applied)`
          : "";
      const tokenBreakdown = `Total: ${displayTotal} tokens${refactoringWarning}
• Cache Read (explicit): ${estimated_cache_read_tokens.toLocaleString()} × ${
        refactoringMultiplier > 1.0
          ? `${refactoringMultiplier}x (refactoring) × `
          : ""
      }${estimated_iterations} iterations = ${cacheReadTotal.toLocaleString()} tokens
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
