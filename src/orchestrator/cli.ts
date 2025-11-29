#!/usr/bin/env node
/**
 * CLI Wrapper for EvolverOrchestrator
 *
 * Provides command-line interface for:
 * - status: Show current session state
 * - search: Search the experience base
 */

import * as os from "node:os";
import * as path from "node:path";
import type { SearchQuery } from "../types.js";
import { EvolverOrchestrator } from "./orchestrator.js";

/**
 * CLI configuration from environment variables
 */
interface CliConfig {
  dbPath: string;
  enableEmbeddings: boolean;
  verbose: boolean;
}

/**
 * Get CLI configuration from environment
 */
function getConfig(): CliConfig {
  return {
    dbPath:
      process.env.EVOLVER_DB_PATH ||
      path.join(os.homedir(), ".evolver", "expbase.db"),
    enableEmbeddings: process.env.EVOLVER_ENABLE_EMBEDDINGS === "true",
    verbose: process.env.EVOLVER_VERBOSE === "true",
  };
}

/**
 * Parse command line arguments
 */
function parseArgs(args: string[]): {
  command: string;
  options: Record<string, string | boolean>;
} {
  const command = args[0] || "help";
  const options: Record<string, string | boolean> = {};

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];

    if (arg.startsWith("--")) {
      const [key, value] = arg.slice(2).split("=");

      if (value !== undefined) {
        // --key=value
        options[key] = value;
      } else {
        // --flag or --key value
        if (i + 1 < args.length && !args[i + 1].startsWith("--")) {
          options[key] = args[i + 1];
          i++;
        } else {
          options[key] = true;
        }
      }
    }
  }

  return { command, options };
}

/**
 * Print help message
 */
function printHelp(): void {
  console.log(`
Evolver Orchestrator CLI

Usage: evolver-cli <command> [options]

Commands:
  status            Show experience base state
  search            Search the experience base
  help              Show this help message

Status Command:
  evolver-cli status

  Shows:
    - ExpBase statistics

Search Command:
  evolver-cli search --query="authentication bug" [options]

  Options:
    --query              Natural language search query
    --tags               Comma-separated tags to filter by
    --mode               Search mode: principles, traces, both (default: both)
    --limit              Maximum results (default: 10)
    --min-similarity     Minimum similarity score 0-1 (default: 0.7)
    --min-score          Minimum principle score 0-1 (default: 0.5)
    --outcome            Filter traces by outcome: success, failure, partial

Environment Variables:
  EVOLVER_DB_PATH              Path to ExpBase database
                               (default: ~/.evolver/expbase.db)

  EVOLVER_ENABLE_EMBEDDINGS    Enable semantic search (true/false)
                               (default: false)

  EVOLVER_VERBOSE              Enable verbose logging (true/false)
                               (default: false)

  OPENAI_API_KEY               OpenAI API key (required for embeddings)

Examples:
  # Search for relevant principles
  evolver-cli search --query="react performance" --mode=principles --limit=5

  # Check status
  evolver-cli status
`);
}

/**
 * Status command - show experience base state
 */
async function statusCommand(orchestrator: EvolverOrchestrator): Promise<void> {
  const stats = orchestrator.getStats();

  console.log(
    JSON.stringify(
      {
        status: "success",
        expbase: {
          principleCount: stats.expbase.principle_count,
          traceCount: stats.expbase.trace_count,
          avgPrincipleScore: stats.expbase.avg_principle_score.toFixed(3),
          topTags: stats.expbase.top_tags?.slice(0, 5),
        },
      },
      null,
      2,
    ),
  );
}

/**
 * Search command - search the experience base
 */
async function searchCommand(
  orchestrator: EvolverOrchestrator,
  options: Record<string, string | boolean>,
): Promise<void> {
  const query: SearchQuery = {};

  if (options.query && typeof options.query === "string") {
    query.query_text = options.query;
  }

  if (options.tags && typeof options.tags === "string") {
    query.tags = options.tags.split(",").map((t) => t.trim());
  }

  if (options.mode && typeof options.mode === "string") {
    query.search_mode = options.mode as "principles" | "traces" | "both";
  }

  if (options.limit && typeof options.limit === "string") {
    query.limit = Number.parseInt(options.limit, 10);
  }

  if (
    options["min-similarity"] &&
    typeof options["min-similarity"] === "string"
  ) {
    query.min_similarity = Number.parseFloat(options["min-similarity"]);
  }

  if (options["min-score"] && typeof options["min-score"] === "string") {
    query.min_principle_score = Number.parseFloat(options["min-score"]);
  }

  if (options.outcome && typeof options.outcome === "string") {
    query.outcome_filter = options.outcome as "success" | "failure" | "partial";
  }

  console.error(`[Search] Querying experience base...`);

  const result = await orchestrator.searchExperience(query);

  console.error(
    `[Search] Found ${result.total_count} results in ${result.query_time_ms}ms`,
  );

  // Format output
  const output = {
    status: "success",
    query,
    results: result.results.map((r) => {
      if (r.type === "principle") {
        const p = r.item as any;
        return {
          type: "principle",
          id: p.id,
          text: p.text,
          tags: p.tags,
          score: (p.success_count + 1) / (p.use_count + 2),
          use_count: p.use_count,
          success_count: p.success_count,
          similarity_score: r.similarity_score,
          match_reason: r.match_reason,
        };
      } else {
        const t = r.item as any;
        return {
          type: "trace",
          id: t.id,
          task_summary: t.task_summary,
          outcome: t.outcome,
          tool_count: t.tool_calls.length,
          duration_ms: t.duration_ms,
          tags: t.tags,
          match_reason: r.match_reason,
        };
      }
    }),
    total_count: result.total_count,
    query_time_ms: result.query_time_ms,
  };

  console.log(JSON.stringify(output, null, 2));
}

/**
 * Main CLI entry point
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    printHelp();
    process.exit(0);
  }

  const { command, options } = parseArgs(args);

  if (command === "help" || options.help) {
    printHelp();
    process.exit(0);
  }

  const config = getConfig();

  if (config.verbose) {
    console.error("[CLI] Configuration:", config);
  }

  // Initialize orchestrator
  const orchestrator = new EvolverOrchestrator({
    dbPath: config.dbPath,
    enableEmbeddings: config.enableEmbeddings,
    verbose: config.verbose,
    embeddingConfig: {
      provider: config.enableEmbeddings ? "openai" : "mock",
    },
  });

  try {
    switch (command) {
      case "status":
        await statusCommand(orchestrator);
        break;

      case "search":
        await searchCommand(orchestrator, options);
        break;

      default:
        console.error(`Unknown command: ${command}`);
        console.error('Run "evolver-cli help" for usage information');
        process.exit(1);
    }
  } catch (error) {
    console.error(
      JSON.stringify(
        {
          status: "error",
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        },
        null,
        2,
      ),
    );
    process.exit(1);
  } finally {
    orchestrator.close();
  }
}

// Run CLI if this is the main module
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
}

