import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import * as fs from "fs/promises";
import * as path from "path";
import { encodingForModel } from "js-tiktoken";

// --- 1. CONFIGURATION ---
const PRICING = {
  // Claude 3.5 Sonnet Prices
  INPUT_PER_M: 3.0,
  CACHE_READ_PER_M: 0.3,
  OUTPUT_PER_M: 15.0,

  // Base IDE Overhead (Project Index)
  IDE_OVERHEAD: 90000,

  // History Growth: How many tokens are added to context per conversation turn?
  // (User reply + Agent reply + Tool results)
  TOKENS_ADDED_PER_TURN: 1500,
};

// Initialize Tokenizer (Lightweight, runs in JS)
const enc = encodingForModel("gpt-4o");

// Ignore these folders to prevent exploding CPU/Memory
const IGNORE_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  "coverage",
]);
// Ignore these extensions (Binaries)
const IGNORE_EXTS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".ico",
  ".pdf",
  ".zip",
  ".lock",
]);

const mcp = new McpServer({
  name: "professional-cost-estimator",
  version: "5.0.0",
});

// --- HELPER: Recursive Token Counter ---
async function analyzePath(
  absolutePath: string
): Promise<{ tokens: number; count: number; skipped: number }> {
  let stats;
  try {
    stats = await fs.stat(absolutePath);
  } catch (e) {
    return { tokens: 0, count: 0, skipped: 1 }; // File not found
  }

  // 1. Handle Directory (Recursive)
  if (stats.isDirectory()) {
    const dirName = path.basename(absolutePath);
    if (IGNORE_DIRS.has(dirName)) return { tokens: 0, count: 0, skipped: 0 };

    const entries = await fs.readdir(absolutePath);
    let total = { tokens: 0, count: 0, skipped: 0 };

    for (const entry of entries) {
      const result = await analyzePath(path.join(absolutePath, entry));
      total.tokens += result.tokens;
      total.count += result.count;
      total.skipped += result.skipped;
    }
    return total;
  }

  // 2. Handle File (Read & Tokenize)
  const ext = path.extname(absolutePath).toLowerCase();
  if (IGNORE_EXTS.has(ext)) return { tokens: 0, count: 0, skipped: 1 };

  try {
    const content = await fs.readFile(absolutePath, "utf-8");
    const tokenCount = enc.encode(content).length;
    return { tokens: tokenCount, count: 1, skipped: 0 };
  } catch (e) {
    // Likely binary file read error or permission
    return { tokens: 0, count: 0, skipped: 1 };
  }
}

mcp.registerTool(
  "get_cost_estimate",
  {
    description:
      "Calculates EXACT cost by tokenizing files on disk. " +
      "Use this for 'cost', 'price', or 'estimate' requests. " +
      "Supports folders (e.g. 'src/') and individual files.",
    inputSchema: z.object({
      task_description: z.string().describe("Brief task summary."),
      target_paths: z
        .array(z.string())
        .describe(
          "List of files OR directories to measure (e.g. ['src/components/', 'package.json'])"
        ),
      complexity: z
        .enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"])
        .describe(
          "LOW: Simple edit. MEDIUM: Multi-file. HIGH: Refactor. CRITICAL: Architecture change."
        ),
      estimated_iterations: z.number().describe("Expected conversation turns."),
    }),
  },
  async ({
    task_description,
    target_paths,
    complexity,
    estimated_iterations,
  }) => {
    // --- STEP 1: EXACT MEASUREMENT ---
    let totalFileTokens = 0;
    let totalFileCount = 0;
    let totalSkipped = 0;

    for (const p of target_paths) {
      const absPath = path.resolve(process.cwd(), p);
      const analysis = await analyzePath(absPath);
      totalFileTokens += analysis.tokens;
      totalFileCount += analysis.count;
      totalSkipped += analysis.skipped;
    }

    // --- STEP 2: SAFETY FLOORS ---
    let minIterations = 1;
    let outputPerTurn = 500;
    let searchOverhead = 0;

    switch (complexity) {
      case "LOW":
        minIterations = 1;
        outputPerTurn = 500;
        break;
      case "MEDIUM":
        minIterations = 2;
        outputPerTurn = 1500;
        break;
      case "HIGH":
        minIterations = 3;
        outputPerTurn = 3000;
        searchOverhead = 60000; // Buffer for implicit dependencies
        break;
      case "CRITICAL":
        minIterations = 4;
        outputPerTurn = 4000;
        searchOverhead = 200000;
        break;
    }

    const safeIterations = Math.max(estimated_iterations, minIterations);

    // --- STEP 3: THE MATH (Advanced History Model) ---

    // A. Base Context (Files + Search + IDE)
    const baseContext = totalFileTokens + searchOverhead + PRICING.IDE_OVERHEAD;

    // B. History Accumulation
    // As you chat, the history grows. We approximate the AVERAGE context size.
    // Turn 1: Base
    // Turn 2: Base + 1500
    // Turn 3: Base + 3000
    // Total Processed = Sum of all turns
    let totalProcessedInput = 0;
    for (let i = 0; i < safeIterations; i++) {
      const historySize = i * PRICING.TOKENS_ADDED_PER_TURN;
      totalProcessedInput += baseContext + historySize;
    }

    // C. Cache Split (30% New / 70% Cache)
    const newInputTokens = Math.round(totalProcessedInput * 0.3);
    const cacheReadTokens = Math.round(totalProcessedInput * 0.7);

    // D. Output
    const totalOutputTokens = safeIterations * outputPerTurn;

    // --- STEP 4: PRICING ---
    const costInput = (newInputTokens / 1e6) * PRICING.INPUT_PER_M;
    const costCache = (cacheReadTokens / 1e6) * PRICING.CACHE_READ_PER_M;
    const costOutput = (totalOutputTokens / 1e6) * PRICING.OUTPUT_PER_M;
    const totalCost = costInput + costCache + costOutput;

    // --- STEP 5: OUTPUT (Dual Format) ---

    const jsonResult = {
      cost_usd: Number(totalCost.toFixed(3)),
      breakdown: {
        files_read: totalFileCount,
        files_skipped: totalSkipped,
        base_context_tokens: baseContext,
        total_processed_tokens: totalProcessedInput + totalOutputTokens,
        iterations: safeIterations,
        complexity: complexity,
      },
      token_split: {
        cache_read: cacheReadTokens,
        new_input: newInputTokens,
        output: totalOutputTokens,
      },
    };

    return {
      content: [
        {
          type: "text",
          text: `[PROFESSIONAL ESTIMATE]
-----------------------------------------
Task: ${task_description}
Target: ${target_paths.join(", ")}
Files Read: ${totalFileCount} (Actual Tokens: ${totalFileTokens.toLocaleString()})
Complexity: ${complexity}
-----------------------------------------
💰 ESTIMATED COST: $${totalCost.toFixed(2)}
-----------------------------------------
Machine Data:
${JSON.stringify(jsonResult, null, 2)}`,
        },
      ],
    };
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await mcp.connect(transport);
  console.error("Professional Cost Estimator v5.0 running...");
}

main();
