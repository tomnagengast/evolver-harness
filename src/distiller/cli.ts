#!/usr/bin/env node

/**
 * CLI for running distillation on traces
 *
 * Commands:
 * - distill [count] - Process N recent undistilled traces (default: 10)
 * - distill-trace <id> - Process specific trace by ID
 * - dedupe - Run deduplication pass on all principles
 * - prune --threshold=0.3 - Remove low-scoring principles
 * - stats - Show experience base statistics
 */

import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { ExpBaseStorage } from "../storage/expbase.js";
import { calculatePrincipleScore } from "../types.js";
import { Distiller } from "./distiller.js";

/**
 * CLI configuration
 */
interface CLIConfig {
  dbPath: string;
  verbose: boolean;
  openaiApiKey?: string;
  model?: string;
  similarityThreshold?: number;
  embeddingProvider?: "openai" | "mock";
}

/**
 * Parse CLI arguments
 */
function parseCliArgs(): {
  command: string;
  args: string[];
  config: CLIConfig;
} {
  const { values, positionals } = parseArgs({
    options: {
      db: { type: "string", short: "d" },
      verbose: { type: "boolean", short: "v", default: false },
      "openai-key": { type: "string" },
      model: { type: "string", short: "m" },
      threshold: { type: "string", short: "t" },
      "min-usage": { type: "string" },
      "similarity-threshold": { type: "string", short: "s" },
      "embedding-provider": { type: "string", short: "e" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
  });

  if (values.help) {
    printHelp();
    process.exit(0);
  }

  const command = positionals[0] || "help";
  const args = positionals.slice(1);

  // Determine database path
  const dbPath =
    values.db ||
    process.env.EXPBASE_DB_PATH ||
    resolve(process.cwd(), "expbase.db");

  const config: CLIConfig = {
    dbPath,
    verbose: values.verbose || false,
    openaiApiKey: values["openai-key"] as string | undefined,
    model: values.model as string | undefined,
    similarityThreshold: values["similarity-threshold"]
      ? Number.parseFloat(values["similarity-threshold"] as string)
      : undefined,
    embeddingProvider: values["embedding-provider"] as
      | "openai"
      | "mock"
      | undefined,
  };

  // Store parsed values for commands
  (config as any).threshold = values.threshold
    ? Number.parseFloat(values.threshold as string)
    : undefined;
  (config as any).minUsage = values["min-usage"]
    ? Number.parseInt(values["min-usage"] as string, 10)
    : undefined;

  return { command, args, config };
}

/**
 * Print help message
 */
function printHelp(): void {
  console.log(`
Distiller CLI - Extract principles from agent traces

USAGE:
  distiller [OPTIONS] <COMMAND> [ARGS]

COMMANDS:
  distill [count]          Process N recent undistilled traces (default: 10)
  distill-trace <id>       Process specific trace by ID
  dedupe                   Run deduplication pass on all principles
  prune                    Remove low-scoring principles
  stats                    Show experience base statistics
  list-traces              List all traces
  list-principles          List all principles
  help                     Show this help message

OPTIONS:
  -d, --db <path>                  Database path (default: ./expbase.db)
  -v, --verbose                    Enable verbose logging
  --openai-key <key>               OpenAI API key for embeddings (or set OPENAI_API_KEY)
  -m, --model <model>              Claude model to use (default: claude-sonnet-4-5-20250929)
  -s, --similarity-threshold <n>   Similarity threshold for merging (default: 0.85)
  -t, --threshold <n>              Score threshold for pruning (default: 0.3)
  --min-usage <n>                  Minimum usage count for pruning (default: 10)
  -e, --embedding-provider <name>  Embedding provider: openai or mock (default: openai)
  -h, --help                       Show this help message

EXAMPLES:
  # Distill 10 most recent traces
  distiller distill

  # Distill 50 traces with verbose output
  distiller -v distill 50

  # Distill specific trace
  distiller distill-trace abc123

  # Run deduplication
  distiller dedupe

  # Prune low-scoring principles
  distiller prune --threshold=0.3 --min-usage=10

  # Show statistics
  distiller stats

ENVIRONMENT VARIABLES:
  EXPBASE_DB_PATH      Path to database file
  ANTHROPIC_API_KEY    Anthropic API key for Claude
  OPENAI_API_KEY       OpenAI API key for embeddings
`);
}

/**
 * Run distill command
 */
async function runDistill(args: string[], config: CLIConfig): Promise<void> {
  const count = args[0] ? Number.parseInt(args[0], 10) : 10;

  if (Number.isNaN(count) || count <= 0) {
    console.error("Error: count must be a positive number");
    process.exit(1);
  }

  console.log(`Distilling ${count} most recent undistilled traces...`);
  console.log(`Database: ${config.dbPath}`);
  console.log();

  const storage = new ExpBaseStorage({ dbPath: config.dbPath });
  const distiller = new Distiller(storage, {
    model: config.model,
    similarityThreshold: config.similarityThreshold,
    embeddingConfig: {
      provider: config.embeddingProvider || "openai",
      apiKey: config.openaiApiKey,
    },
    verbose: config.verbose,
  });

  try {
    const result = await distiller.distillRecent(count);

    console.log("\n=== Distillation Complete ===\n");
    console.log(`Traces processed: ${result.traces_processed}`);
    console.log(`Traces used: ${result.traces_used}`);
    console.log(`New principles: ${result.new_principles.length}`);
    console.log(`Updated principles: ${result.updated_principles.length}`);
    console.log(`Duration: ${(result.duration_ms / 1000).toFixed(2)}s`);

    if (result.issues && result.issues.length > 0) {
      console.log(`\nIssues: ${result.issues.length}`);
      for (const issue of result.issues) {
        console.log(`  [${issue.severity}] ${issue.message}`);
      }
    }

    if (result.new_principles.length > 0) {
      console.log("\n=== New Principles ===\n");
      for (const principle of result.new_principles) {
        console.log(`- [${principle.id}] ${principle.text}`);
        console.log(`  Tags: ${principle.tags.join(", ")}`);
        console.log(`  Examples: ${principle.examples.length}`);
        console.log();
      }
    }

    if (result.updated_principles.length > 0) {
      console.log("=== Updated Principles ===\n");
      for (const principle of result.updated_principles) {
        console.log(`- [${principle.id}] ${principle.text}`);
        console.log(`  Examples: ${principle.examples.length}`);
        console.log(
          `  Score: ${calculatePrincipleScore(principle).toFixed(3)}`,
        );
        console.log();
      }
    }
  } catch (error) {
    console.error(
      "Error:",
      error instanceof Error ? error.message : String(error),
    );
    process.exit(1);
  } finally {
    storage.close();
  }
}

/**
 * Run distill-trace command
 */
async function runDistillTrace(
  args: string[],
  config: CLIConfig,
): Promise<void> {
  const traceId = args[0];

  if (!traceId) {
    console.error("Error: trace ID required");
    console.error("Usage: distiller distill-trace <trace-id>");
    process.exit(1);
  }

  console.log(`Distilling trace ${traceId}...`);
  console.log(`Database: ${config.dbPath}`);
  console.log();

  const storage = new ExpBaseStorage({ dbPath: config.dbPath });
  const distiller = new Distiller(storage, {
    model: config.model,
    similarityThreshold: config.similarityThreshold,
    embeddingConfig: {
      provider: config.embeddingProvider || "openai",
      apiKey: config.openaiApiKey,
    },
    verbose: config.verbose,
  });

  try {
    const result = await distiller.distillTrace(traceId);

    console.log("\n=== Distillation Complete ===\n");
    console.log(`New principles: ${result.new_principles.length}`);
    console.log(`Updated principles: ${result.updated_principles.length}`);
    console.log(`Duration: ${(result.duration_ms / 1000).toFixed(2)}s`);

    if (result.issues && result.issues.length > 0) {
      console.log(`\nIssues: ${result.issues.length}`);
      for (const issue of result.issues) {
        console.log(`  [${issue.severity}] ${issue.message}`);
      }
    }

    if (result.new_principles.length > 0) {
      console.log("\n=== New Principles ===\n");
      for (const principle of result.new_principles) {
        console.log(`- [${principle.id}] ${principle.text}`);
        console.log(`  Tags: ${principle.tags.join(", ")}`);
        console.log();
      }
    }

    if (result.updated_principles.length > 0) {
      console.log("=== Updated Principles ===\n");
      for (const principle of result.updated_principles) {
        console.log(`- [${principle.id}] ${principle.text}`);
        console.log(
          `  Score: ${calculatePrincipleScore(principle).toFixed(3)}`,
        );
        console.log();
      }
    }
  } catch (error) {
    console.error(
      "Error:",
      error instanceof Error ? error.message : String(error),
    );
    process.exit(1);
  } finally {
    storage.close();
  }
}

/**
 * Run dedupe command
 */
async function runDedupe(config: CLIConfig): Promise<void> {
  console.log("Running deduplication pass...");
  console.log(`Database: ${config.dbPath}`);
  console.log();

  const storage = new ExpBaseStorage({ dbPath: config.dbPath });
  const distiller = new Distiller(storage, {
    model: config.model,
    similarityThreshold: config.similarityThreshold,
    embeddingConfig: {
      provider: config.embeddingProvider || "openai",
      apiKey: config.openaiApiKey,
    },
    verbose: config.verbose,
  });

  try {
    const result = await distiller.deduplicatePrinciples();

    console.log("\n=== Deduplication Complete ===\n");
    console.log(`Principles merged: ${result.merged}`);
    console.log(`Principles updated: ${result.updated_principles.length}`);

    if (result.updated_principles.length > 0) {
      console.log("\n=== Updated Principles ===\n");
      for (const principle of result.updated_principles) {
        console.log(`- [${principle.id}] ${principle.text}`);
        console.log(`  Examples: ${principle.examples.length}`);
        console.log(
          `  Score: ${calculatePrincipleScore(principle).toFixed(3)}`,
        );
        console.log();
      }
    }
  } catch (error) {
    console.error(
      "Error:",
      error instanceof Error ? error.message : String(error),
    );
    process.exit(1);
  } finally {
    storage.close();
  }
}

/**
 * Run prune command
 */
function runPrune(config: CLIConfig): void {
  const threshold = (config as any).threshold ?? 0.3;
  const minUsage = (config as any).minUsage ?? 10;

  console.log("Pruning low-scoring principles...");
  console.log(`Database: ${config.dbPath}`);
  console.log(`Threshold: ${threshold}`);
  console.log(`Minimum usage: ${minUsage}`);
  console.log();

  const storage = new ExpBaseStorage({ dbPath: config.dbPath });
  const distiller = new Distiller(storage, {
    verbose: config.verbose,
  });

  try {
    const prunedIds = distiller.prunePrinciples(threshold, minUsage);

    console.log("\n=== Pruning Complete ===\n");
    console.log(`Principles removed: ${prunedIds.length}`);

    if (prunedIds.length > 0 && config.verbose) {
      console.log("\nRemoved principle IDs:");
      for (const id of prunedIds) {
        console.log(`  - ${id}`);
      }
    }
  } catch (error) {
    console.error(
      "Error:",
      error instanceof Error ? error.message : String(error),
    );
    process.exit(1);
  } finally {
    storage.close();
  }
}

/**
 * Show experience base statistics
 */
function runStats(config: CLIConfig): void {
  console.log("Experience Base Statistics");
  console.log(`Database: ${config.dbPath}`);
  console.log();

  const storage = new ExpBaseStorage({ dbPath: config.dbPath });

  try {
    const stats = storage.getStats();

    console.log("=== Overview ===\n");
    console.log(`Principles: ${stats.principle_count}`);
    console.log(`Traces: ${stats.trace_count}`);
    console.log(
      `Average principle score: ${stats.avg_principle_score.toFixed(3)}`,
    );

    if (stats.trace_success_rate !== undefined) {
      console.log(
        `Trace success rate: ${(stats.trace_success_rate * 100).toFixed(1)}%`,
      );
    }

    if (stats.avg_trace_duration_ms !== undefined) {
      console.log(
        `Average trace duration: ${(stats.avg_trace_duration_ms / 1000).toFixed(2)}s`,
      );
    }

    if (stats.score_distribution) {
      console.log("\n=== Score Distribution ===\n");
      console.log(`Min: ${stats.score_distribution.min.toFixed(3)}`);
      console.log(`P25: ${stats.score_distribution.p25.toFixed(3)}`);
      console.log(`Median: ${stats.score_distribution.median.toFixed(3)}`);
      console.log(`P75: ${stats.score_distribution.p75.toFixed(3)}`);
      console.log(`P90: ${stats.score_distribution.p90.toFixed(3)}`);
      console.log(`Max: ${stats.score_distribution.max.toFixed(3)}`);
    }

    if (stats.top_tags && stats.top_tags.length > 0) {
      console.log("\n=== Top Tags ===\n");
      for (const { tag, count } of stats.top_tags.slice(0, 10)) {
        console.log(`${count.toString().padStart(4)} - ${tag}`);
      }
    }

    if (stats.top_principles && stats.top_principles.length > 0) {
      console.log("\n=== Top Principles ===\n");
      for (const { principle, score, rank } of stats.top_principles.slice(
        0,
        10,
      )) {
        console.log(`${rank}. [${score.toFixed(3)}] ${principle.text}`);
        console.log(
          `   Use: ${principle.use_count}, Success: ${principle.success_count}`,
        );
        console.log();
      }
    }

    if (stats.time_range) {
      console.log("=== Time Range ===\n");
      console.log(
        `Earliest: ${new Date(stats.time_range.earliest).toLocaleString()}`,
      );
      console.log(
        `Latest: ${new Date(stats.time_range.latest).toLocaleString()}`,
      );
    }
  } catch (error) {
    console.error(
      "Error:",
      error instanceof Error ? error.message : String(error),
    );
    process.exit(1);
  } finally {
    storage.close();
  }
}

/**
 * List all traces
 */
function runListTraces(config: CLIConfig): void {
  console.log("All Traces");
  console.log(`Database: ${config.dbPath}`);
  console.log();

  const storage = new ExpBaseStorage({ dbPath: config.dbPath });

  try {
    const traces = storage.getAllTraces();

    console.log(`Total: ${traces.length} traces\n`);

    for (const trace of traces.slice(0, 50)) {
      console.log(`[${trace.id}]`);
      console.log(`  Task: ${trace.task_summary}`);
      console.log(
        `  Outcome: ${trace.outcome.status} (score: ${trace.outcome.score})`,
      );
      console.log(`  Duration: ${(trace.duration_ms / 1000).toFixed(2)}s`);
      console.log(`  Created: ${new Date(trace.created_at).toLocaleString()}`);
      console.log();
    }

    if (traces.length > 50) {
      console.log(`... and ${traces.length - 50} more`);
    }
  } catch (error) {
    console.error(
      "Error:",
      error instanceof Error ? error.message : String(error),
    );
    process.exit(1);
  } finally {
    storage.close();
  }
}

/**
 * List all principles
 */
function runListPrinciples(config: CLIConfig): void {
  console.log("All Principles");
  console.log(`Database: ${config.dbPath}`);
  console.log();

  const storage = new ExpBaseStorage({ dbPath: config.dbPath });

  try {
    const principles = storage.getAllPrinciples();

    console.log(`Total: ${principles.length} principles\n`);

    for (const principle of principles) {
      const score = calculatePrincipleScore(principle);
      console.log(`[${principle.id}] ${principle.text}`);
      console.log(
        `  Score: ${score.toFixed(3)} (use: ${principle.use_count}, success: ${principle.success_count})`,
      );
      console.log(`  Tags: ${principle.tags.join(", ")}`);
      console.log(`  Examples: ${principle.examples.length}`);
      console.log();
    }
  } catch (error) {
    console.error(
      "Error:",
      error instanceof Error ? error.message : String(error),
    );
    process.exit(1);
  } finally {
    storage.close();
  }
}

/**
 * Main CLI entry point
 */
async function main(): Promise<void> {
  const { command, args, config } = parseCliArgs();

  switch (command) {
    case "distill":
      await runDistill(args, config);
      break;

    case "distill-trace":
      await runDistillTrace(args, config);
      break;

    case "dedupe":
      await runDedupe(config);
      break;

    case "prune":
      runPrune(config);
      break;

    case "stats":
      runStats(config);
      break;

    case "list-traces":
      runListTraces(config);
      break;

    case "list-principles":
      runListPrinciples(config);
      break;

    case "help":
      printHelp();
      break;

    default:
      console.error(`Unknown command: ${command}`);
      console.error('Run "distiller help" for usage information');
      process.exit(1);
  }
}

// Run CLI
main().catch((error) => {
  console.error(
    "Fatal error:",
    error instanceof Error ? error.message : String(error),
  );
  process.exit(1);
});

