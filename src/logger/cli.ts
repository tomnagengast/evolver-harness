#!/usr/bin/env node

/**
 * CLI interface for TraceLogger
 * Designed to be invoked from Claude Code hooks
 *
 * Commands:
 *   start      - Start a new logging session
 *   log-tool   - Log a tool call to the current session
 *   log-thought - Log an intermediate thought
 *   end        - End the current session and save to ExpBase
 *   status     - Show current session status
 *   abandon    - Abandon the current session without saving
 */

import * as os from "node:os";
import * as path from "node:path";
import type { TraceOutcome } from "../types.js";
import {
  type LogSession,
  SessionStateManager,
  TraceLogger,
} from "./trace-logger.js";

/**
 * Parse command line arguments into a structured format
 */
function parseArgs(args: string[]): {
  command: string;
  options: Record<string, string>;
} {
  const command = args[0] || "help";
  const options: Record<string, string> = {};

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith("--")) {
      const [key, ...valueParts] = arg.slice(2).split("=");
      const value =
        valueParts.join("=") ||
        (args[i + 1] && !args[i + 1].startsWith("--") ? args[++i] : "true");
      options[key] = value;
    }
  }

  return { command, options };
}

/**
 * Main CLI handler
 */
async function main() {
  const args = process.argv.slice(2);
  const { command, options } = parseArgs(args);

  // Default paths
  const dbPath =
    options.dbPath ||
    process.env.EVOLVER_DB_PATH ||
    path.join(os.homedir(), ".evolver", "expbase.db");
  const stateFilePath =
    options.stateFile ||
    process.env.EVOLVER_STATE_FILE ||
    path.join(os.tmpdir(), "evolver-harness-session.json");

  const stateManager = new SessionStateManager(stateFilePath);

  try {
    switch (command) {
      case "start": {
        if (stateManager.hasState()) {
          console.error(
            'Error: A session is already active. Use "end" or "abandon" first.',
          );
          process.exit(1);
        }

        const taskSummary =
          options.task || options.taskSummary || "Unknown task";
        const problemDescription =
          options.problem ||
          options.problemDescription ||
          "No description provided";
        const modelUsed =
          options.model ||
          options.modelUsed ||
          process.env.CLAUDE_MODEL ||
          "unknown";
        const agentId =
          options.agent || options.agentId || process.env.CLAUDE_AGENT_ID;
        const sessionId = options.session || options.sessionId;

        const session: LogSession = {
          id: sessionId || crypto.randomUUID(),
          taskSummary,
          problemDescription,
          toolCalls: [],
          intermediateThoughts: [],
          startTime: Date.now(),
          modelUsed,
          agentId,
        };

        stateManager.saveState(session);
        console.log(
          JSON.stringify({
            status: "success",
            sessionId: session.id,
            message: "Session started",
          }),
        );
        break;
      }

      case "log-tool": {
        const session = stateManager.loadState();
        if (!session) {
          console.error('Error: No active session. Use "start" first.');
          process.exit(1);
        }

        const tool = options.tool;
        if (!tool) {
          console.error("Error: --tool is required");
          process.exit(1);
        }

        const input = options.input ? JSON.parse(options.input) : {};
        const output = options.output
          ? options.output.startsWith("{") || options.output.startsWith("[")
            ? JSON.parse(options.output)
            : options.output
          : null;
        const timestamp = options.timestamp || new Date().toISOString();
        const durationMs = options.duration
          ? Number.parseInt(options.duration, 10)
          : undefined;

        let error;
        if (options.error) {
          error = {
            message: options.errorMessage || options.error,
            code: options.errorCode,
            stack: options.errorStack,
          };
        }

        session.toolCalls.push({
          tool,
          input,
          output,
          timestamp,
          duration_ms: durationMs,
          error,
        });

        stateManager.saveState(session);
        console.log(
          JSON.stringify({
            status: "success",
            message: "Tool call logged",
            toolCallCount: session.toolCalls.length,
          }),
        );
        break;
      }

      case "log-thought": {
        const session = stateManager.loadState();
        if (!session) {
          console.error('Error: No active session. Use "start" first.');
          process.exit(1);
        }

        const thought = options.thought || options.message;
        if (!thought) {
          console.error("Error: --thought or --message is required");
          process.exit(1);
        }

        session.intermediateThoughts.push(thought);
        stateManager.saveState(session);
        console.log(
          JSON.stringify({
            status: "success",
            message: "Thought logged",
            thoughtCount: session.intermediateThoughts.length,
          }),
        );
        break;
      }

      case "end": {
        const session = stateManager.loadState();
        if (!session) {
          console.error("Error: No active session to end.");
          process.exit(1);
        }

        const finalAnswer =
          options.answer || options.finalAnswer || "No final answer provided";
        const outcomeStatus = (options.outcome ||
          options.status ||
          "success") as "success" | "failure" | "partial";
        const outcomeScore = options.score
          ? Number.parseFloat(options.score)
          : outcomeStatus === "success"
            ? 1.0
            : 0.0;
        const outcomeExplanation =
          options.explanation || options.outcomeExplanation;

        const outcome: TraceOutcome = {
          status: outcomeStatus,
          score: outcomeScore,
          explanation: outcomeExplanation,
        };

        const tags = options.tags
          ? options.tags.split(",").map((t: string) => t.trim())
          : undefined;
        const context = options.context
          ? JSON.parse(options.context)
          : undefined;

        // Create logger and save trace
        const logger = new TraceLogger(dbPath);

        // Reconstruct session in logger
        logger.currentSession = session;

        const trace = logger.endSession(finalAnswer, outcome, {
          tags,
          context,
        });
        logger.close();

        stateManager.clearState();
        console.log(
          JSON.stringify({
            status: "success",
            message: "Session ended and trace saved",
            traceId: trace.id,
            sessionId: session.id,
            toolCallCount: session.toolCalls.length,
            thoughtCount: session.intermediateThoughts.length,
            durationMs: trace.duration_ms,
          }),
        );
        break;
      }

      case "status": {
        const session = stateManager.loadState();
        if (!session) {
          console.log(
            JSON.stringify({
              status: "no_session",
              message: "No active session",
            }),
          );
        } else {
          const durationMs = Date.now() - session.startTime;
          console.log(
            JSON.stringify({
              status: "active",
              sessionId: session.id,
              taskSummary: session.taskSummary,
              toolCallCount: session.toolCalls.length,
              thoughtCount: session.intermediateThoughts.length,
              durationMs,
              modelUsed: session.modelUsed,
              stateFile: stateFilePath,
            }),
          );
        }
        break;
      }

      case "abandon": {
        if (stateManager.hasState()) {
          stateManager.clearState();
          console.log(
            JSON.stringify({ status: "success", message: "Session abandoned" }),
          );
        } else {
          console.log(
            JSON.stringify({
              status: "no_session",
              message: "No active session to abandon",
            }),
          );
        }
        break;
      }
      default: {
        console.log(`
Evolver Harness Trace Logger CLI

Usage: node cli.js <command> [options]

Commands:
  start         Start a new logging session
  log-tool      Log a tool call to the current session
  log-thought   Log an intermediate thought
  end           End the current session and save to ExpBase
  status        Show current session status
  abandon       Abandon the current session without saving
  help          Show this help message

Options:
  --dbPath=PATH              Path to ExpBase database (default: ~/.evolver/expbase.db)
  --stateFile=PATH           Path to session state file (default: temp dir)

Start command options:
  --task=TEXT                Task summary
  --problem=TEXT             Problem description
  --model=TEXT               Model name
  --agent=TEXT               Agent ID
  --session=ID               Session ID (auto-generated if not provided)

Log-tool command options:
  --tool=NAME                Tool name (required)
  --input=JSON               Tool input as JSON
  --output=JSON              Tool output as JSON or string
  --timestamp=ISO8601        Timestamp (auto-generated if not provided)
  --duration=MS              Duration in milliseconds
  --error=TEXT               Error message (if tool failed)
  --errorCode=CODE           Error code
  --errorStack=TEXT          Error stack trace

Log-thought command options:
  --thought=TEXT             The thought/reasoning step to log
  --message=TEXT             Alias for --thought

End command options:
  --answer=TEXT              Final answer (required)
  --outcome=STATUS           Outcome status: success, failure, or partial
  --score=NUMBER             Outcome score (0-1)
  --explanation=TEXT         Outcome explanation
  --tags=TAG1,TAG2           Comma-separated tags
  --context=JSON             Context as JSON

Environment variables:
  EVOLVER_DB_PATH           Default database path
  EVOLVER_STATE_FILE        Default state file path
  CLAUDE_MODEL              Default model name
  CLAUDE_AGENT_ID           Default agent ID

Examples:
  # Start a session
  node cli.js start --task="Fix bug" --problem="Login fails"

  # Log a tool call
  node cli.js log-tool --tool=Read --input='{"file":"foo.ts"}' --output='contents...'

  # Log a thought
  node cli.js log-thought --thought="Checking authentication logic"

  # End session
  node cli.js end --answer="Fixed authentication" --outcome=success --score=1.0

  # Check status
  node cli.js status
`);
        break;
      }
    }
  } catch (error) {
    console.error(
      JSON.stringify({
        status: "error",
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      }),
    );
    process.exit(1);
  }
}

main();

