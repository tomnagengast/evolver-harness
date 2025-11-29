#!/usr/bin/env bun

/**
 * CLI for Experience Retrieval Operations
 *
 * Provides command-line interface for searching and managing principles
 * in the experience base.
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { SearchQuery } from "../types";
import { PrincipleInjector } from "./injector";
import { ExperienceRetriever } from "./retriever";

const DEFAULT_DB_PATH = resolve(process.cwd(), "expbase.db");

/**
 * Print usage information
 */
function printUsage(): void {
  console.log(`
Usage: bun src/retriever/cli.ts <command> [options]

Commands:
  search          Search for relevant principles
  inject          Format and inject principles into output
  record-outcome  Record the outcome of using a principle
  show            Show details of a specific principle
  top             Show top-ranked principles
  stats           Show experience base statistics

Search Options:
  --query="text"      Free-text query for semantic search
  --tags="tag1,tag2"  Filter by tags (comma-separated)
  --top=N             Number of results to return (default: 5)
  --db=path           Path to database (default: ./expbase.db)
  --verbose           Enable verbose output

Inject Options:
  --query="text"      Query to find relevant principles
  --tags="tag1,tag2"  Filter by tags
  --output=mode       Output mode: stdout|claudemd (default: stdout)
  --project=path      Project path for claudemd output (default: .)
  --format=style      Format style: compact|detailed|markdown (default: detailed)
  --db=path           Path to database

Record Outcome Options:
  --principle-id=ID   ID of the principle that was used
  --success=bool      Whether it was successful (true/false)
  --trace-id=ID       Optional trace ID
  --db=path           Path to database

Show Options:
  --principle-id=ID   ID of the principle to show
  --db=path           Path to database

Top Options:
  --top=N             Number of top principles to show (default: 10)
  --format=style      Format style: compact|detailed|json (default: compact)
  --db=path           Path to database

Stats Options:
  --db=path           Path to database

Examples:
  # Search for debugging principles
  bun src/retriever/cli.ts search --query="debugging techniques" --tags="debug" --top=5

  # Inject principles into CLAUDE.md
  bun src/retriever/cli.ts inject --tags="testing,quality" --output=claudemd

  # Record successful use of a principle
  bun src/retriever/cli.ts record-outcome --principle-id=abc123 --success=true

  # Show top 5 principles
  bun src/retriever/cli.ts top --top=5

  # Show detailed information about a principle
  bun src/retriever/cli.ts show --principle-id=abc123
`);
}

/**
 * Parse command-line arguments
 */
function parseArguments(): {
  command: string;
  options: Record<string, string | boolean | undefined>;
} {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    printUsage();
    process.exit(1);
  }

  const command = args[0];

  // Parse options
  const options: Record<string, string | boolean | undefined> = {};
  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith("--")) {
      const [key, value] = arg.substring(2).split("=");
      if (value === undefined) {
        // Flag without value (e.g., --verbose)
        options[key] = true;
      } else {
        options[key] = value;
      }
    }
  }

  return { command, options };
}

/**
 * Execute search command
 */
async function searchCommand(
  options: Record<string, string | boolean | undefined>,
): Promise<void> {
  const dbPath = (options.db as string) || DEFAULT_DB_PATH;

  if (!existsSync(dbPath)) {
    console.error(`Error: Database not found at ${dbPath}`);
    process.exit(1);
  }

  const retriever = new ExperienceRetriever({
    dbPath,
    verbose: options.verbose as boolean,
  });

  try {
    // Build search query
    const query: SearchQuery = {
      limit: options.top ? Number.parseInt(options.top as string, 10) : 5,
    };

    if (options.query) {
      query.query_text = options.query as string;
    }

    if (options.tags) {
      query.tags = (options.tags as string).split(",").map((t) => t.trim());
    }

    // Execute search
    const response = await retriever.searchExperience(query);

    // Display results
    console.log(
      `\nFound ${response.total_count} matching principles (showing top ${response.results.length}):`,
    );
    console.log(`Query time: ${response.query_time_ms}ms\n`);

    for (let i = 0; i < response.results.length; i++) {
      const result = response.results[i];
      if (result.type === "principle") {
        const principle = result.item;
        console.log(
          `${i + 1}. [${principle.id.substring(0, 8)}...] ${principle.text}`,
        );
        console.log(`   Tags: ${principle.tags.join(", ")}`);
        console.log(`   Match: ${result.match_reason}`);
        if (result.similarity_score !== undefined) {
          console.log(
            `   Relevance: ${(result.similarity_score * 100).toFixed(1)}%`,
          );
        }
        console.log();
      }
    }
  } catch (error) {
    console.error(
      `Error: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  } finally {
    retriever.close();
  }
}

/**
 * Execute inject command
 */
async function injectCommand(
  options: Record<string, string | boolean | undefined>,
): Promise<void> {
  const dbPath = (options.db as string) || DEFAULT_DB_PATH;
  const outputMode = (options.output as string) || "stdout";
  const projectPath = (options.project as string) || process.cwd();
  const formatStyle = (options.format as string) || "detailed";

  if (!existsSync(dbPath)) {
    console.error(`Error: Database not found at ${dbPath}`);
    process.exit(1);
  }

  const retriever = new ExperienceRetriever({
    dbPath,
    verbose: options.verbose as boolean,
  });

  const injector = new PrincipleInjector({
    formatStyle: formatStyle as "compact" | "detailed" | "markdown",
    includeStats: true,
    includeExamples: false,
  });

  try {
    // Build search query
    const query: SearchQuery = {
      limit: options.top ? Number.parseInt(options.top as string, 10) : 10,
    };

    if (options.query) {
      query.query_text = options.query as string;
    }

    if (options.tags) {
      query.tags = (options.tags as string).split(",").map((t) => t.trim());
    }

    // Execute search
    const response = await retriever.searchExperience(query);
    const principles = response.results
      .filter((r) => r.type === "principle")
      .map((r) => r.item);

    if (principles.length === 0) {
      console.log("No principles found matching the query");
      return;
    }

    // Format and output
    if (outputMode === "claudemd") {
      injector.updateClaudeMd(projectPath, principles);
    } else {
      // stdout
      const formatted = injector.formatPrinciplesForPrompt(principles);
      console.log(formatted);
    }
  } catch (error) {
    console.error(
      `Error: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  } finally {
    retriever.close();
  }
}

/**
 * Execute record-outcome command
 */
async function recordOutcomeCommand(
  options: Record<string, string | boolean | undefined>,
): Promise<void> {
  const dbPath = (options.db as string) || DEFAULT_DB_PATH;

  if (!existsSync(dbPath)) {
    console.error(`Error: Database not found at ${dbPath}`);
    process.exit(1);
  }

  if (!options["principle-id"]) {
    console.error("Error: --principle-id is required");
    process.exit(1);
  }

  if (options.success === undefined) {
    console.error("Error: --success is required (true or false)");
    process.exit(1);
  }

  const principleId = options["principle-id"] as string;
  const success = options.success === "true" || options.success === true;
  const traceId = options["trace-id"] as string | undefined;

  const retriever = new ExperienceRetriever({
    dbPath,
    verbose: options.verbose as boolean,
  });

  try {
    await retriever.recordUsage(principleId, success, traceId);
    console.log(
      `✓ Recorded ${success ? "successful" : "unsuccessful"} use of principle ${principleId}`,
    );
  } catch (error) {
    console.error(
      `Error: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  } finally {
    retriever.close();
  }
}

/**
 * Execute show command
 */
async function showCommand(
  options: Record<string, string | boolean | undefined>,
): Promise<void> {
  const dbPath = (options.db as string) || DEFAULT_DB_PATH;

  if (!existsSync(dbPath)) {
    console.error(`Error: Database not found at ${dbPath}`);
    process.exit(1);
  }

  if (!options["principle-id"]) {
    console.error("Error: --principle-id is required");
    process.exit(1);
  }

  const principleId = options["principle-id"] as string;

  const retriever = new ExperienceRetriever({
    dbPath,
    verbose: options.verbose as boolean,
  });

  const injector = new PrincipleInjector();

  try {
    const principle = retriever.getPrinciple(principleId);

    if (!principle) {
      console.error(`Error: Principle ${principleId} not found`);
      process.exit(1);
    }

    const formatted = injector.formatPrincipleDetailed(principle);
    console.log(formatted);
  } catch (error) {
    console.error(
      `Error: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  } finally {
    retriever.close();
  }
}

/**
 * Execute top command
 */
async function topCommand(
  options: Record<string, string | boolean | undefined>,
): Promise<void> {
  const dbPath = (options.db as string) || DEFAULT_DB_PATH;
  const k = options.top ? Number.parseInt(options.top as string, 10) : 10;
  const format = (options.format as string) || "compact";

  if (!existsSync(dbPath)) {
    console.error(`Error: Database not found at ${dbPath}`);
    process.exit(1);
  }

  const retriever = new ExperienceRetriever({
    dbPath,
    verbose: options.verbose as boolean,
  });

  const injector = new PrincipleInjector();

  try {
    const topPrinciples = retriever.getTopPrinciples(k);

    if (topPrinciples.length === 0) {
      console.log("No principles found");
      return;
    }

    console.log(`\nTop ${topPrinciples.length} Principles:\n`);

    if (format === "json") {
      console.log(injector.formatJson(topPrinciples));
    } else if (format === "detailed") {
      const formatted = injector.formatPrinciplesForPrompt(topPrinciples);
      console.log(formatted);
    } else {
      // compact
      const formatted = injector.formatCompact(topPrinciples);
      console.log(formatted);
    }
  } catch (error) {
    console.error(
      `Error: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  } finally {
    retriever.close();
  }
}

/**
 * Execute stats command
 */
async function statsCommand(
  options: Record<string, string | boolean | undefined>,
): Promise<void> {
  const dbPath = (options.db as string) || DEFAULT_DB_PATH;

  if (!existsSync(dbPath)) {
    console.error(`Error: Database not found at ${dbPath}`);
    process.exit(1);
  }

  const retriever = new ExperienceRetriever({
    dbPath,
    verbose: options.verbose as boolean,
  });

  try {
    const stats = retriever.getStorage().getStats();

    console.log("\n=== Experience Base Statistics ===\n");
    console.log(`Principles: ${stats.principle_count}`);
    console.log(`Traces: ${stats.trace_count}`);
    console.log(
      `Average Principle Score: ${(stats.avg_principle_score * 100).toFixed(1)}%`,
    );

    if (stats.trace_success_rate !== undefined) {
      console.log(
        `Trace Success Rate: ${(stats.trace_success_rate * 100).toFixed(1)}%`,
      );
    }

    if (stats.avg_trace_duration_ms !== undefined) {
      console.log(
        `Average Trace Duration: ${(stats.avg_trace_duration_ms / 1000).toFixed(2)}s`,
      );
    }

    if (stats.score_distribution) {
      console.log("\nScore Distribution:");
      console.log(
        `  Min:    ${(stats.score_distribution.min * 100).toFixed(1)}%`,
      );
      console.log(
        `  25th:   ${(stats.score_distribution.p25 * 100).toFixed(1)}%`,
      );
      console.log(
        `  Median: ${(stats.score_distribution.median * 100).toFixed(1)}%`,
      );
      console.log(
        `  75th:   ${(stats.score_distribution.p75 * 100).toFixed(1)}%`,
      );
      console.log(
        `  90th:   ${(stats.score_distribution.p90 * 100).toFixed(1)}%`,
      );
      console.log(
        `  Max:    ${(stats.score_distribution.max * 100).toFixed(1)}%`,
      );
    }

    if (stats.top_tags && stats.top_tags.length > 0) {
      console.log("\nTop Tags:");
      for (const tagInfo of stats.top_tags.slice(0, 10)) {
        console.log(`  ${tagInfo.tag}: ${tagInfo.count}`);
      }
    }

    if (stats.time_range) {
      console.log("\nTime Range:");
      console.log(`  Earliest: ${stats.time_range.earliest}`);
      console.log(`  Latest:   ${stats.time_range.latest}`);
    }

    console.log();
  } catch (error) {
    console.error(
      `Error: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  } finally {
    retriever.close();
  }
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  const { command, options } = parseArguments();

  switch (command) {
    case "search":
      await searchCommand(options);
      break;
    case "inject":
      await injectCommand(options);
      break;
    case "record-outcome":
      await recordOutcomeCommand(options);
      break;
    case "show":
      await showCommand(options);
      break;
    case "top":
      await topCommand(options);
      break;
    case "stats":
      await statsCommand(options);
      break;
    case "help":
    case "--help":
    case "-h":
      printUsage();
      break;
    default:
      console.error(`Unknown command: ${command}`);
      printUsage();
      process.exit(1);
  }
}

// Run main if this is the entry point
if (import.meta.main) {
  main().catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
}

