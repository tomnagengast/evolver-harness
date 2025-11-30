#!/usr/bin/env bun

/**
 * SessionEnd Hook - Saves trace to ExpBase
 */

import { unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const DB_PATH =
  process.env.EVOLVER_DB_PATH || join(homedir(), ".evolver", "expbase.db");
const STATE_FILE =
  process.env.EVOLVER_STATE_FILE ||
  join(homedir(), ".evolver", "session-state.json");
const VERBOSE = process.env.EVOLVER_VERBOSE === "true";

interface SessionState {
  sessionId: string;
  startTime: string;
  prompts?: string[];
  toolCalls: Array<{
    tool: string;
    input: unknown;
    output: unknown;
    timestamp: string;
  }>;
}

function extractTaskSummary(prompts: string[]): string {
  if (!prompts || prompts.length === 0) return "Claude Code session";

  // Use first substantive prompt as task summary
  const firstPrompt = prompts[0];
  if (!firstPrompt || firstPrompt.length < 10) return "Claude Code session";

  // Truncate to reasonable length for summary
  const maxLen = 200;
  if (firstPrompt.length <= maxLen) return firstPrompt;

  // Find natural break point
  const truncated = firstPrompt.slice(0, maxLen);
  const lastSpace = truncated.lastIndexOf(" ");
  return lastSpace > maxLen / 2
    ? `${truncated.slice(0, lastSpace)}...`
    : `${truncated}...`;
}

function extractProblemDescription(
  prompts: string[],
  toolCalls: SessionState["toolCalls"],
): string {
  const parts: string[] = [];

  if (prompts && prompts.length > 0) {
    parts.push(`${prompts.length} prompt(s)`);
  }

  parts.push(`${toolCalls.length} tool call(s)`);

  // Identify key tools used
  const toolTypes = new Set(toolCalls.map((tc) => tc.tool));
  if (toolTypes.size > 0) {
    const notable = ["Edit", "Write", "Bash", "Read", "Grep", "Glob"];
    const used = notable.filter((t) => toolTypes.has(t));
    if (used.length > 0) {
      parts.push(`Tools: ${used.join(", ")}`);
    }
  }

  return parts.join(". ");
}

function inferOutcome(toolCalls: SessionState["toolCalls"]) {
  if (toolCalls.length === 0) return { status: "partial" as const, score: 0.5 };

  const hasErrors = toolCalls.some((tc) => {
    const out =
      typeof tc.output === "string" ? tc.output : JSON.stringify(tc.output);
    return /error|failed/i.test(out);
  });

  const hasEdits = toolCalls.some((tc) =>
    ["Edit", "Write", "NotebookEdit"].includes(tc.tool),
  );

  if (hasErrors && !hasEdits) return { status: "failure" as const, score: 0.3 };
  if (hasEdits) return { status: "success" as const, score: 0.8 };
  return { status: "partial" as const, score: 0.5 };
}

async function main() {
  try {
    const input = await Bun.stdin.json().catch(() => null);
    const sessionId =
      input?.session_id || process.env.EVOLVER_SESSION_ID || "unknown";

    const stateFile = Bun.file(STATE_FILE);
    if (!(await stateFile.exists())) process.exit(0);

    const state = (await stateFile.json()) as SessionState;
    if (state.sessionId !== sessionId) process.exit(0);

    // Skip trace save on clear
    if (input?.reason === "clear") {
      await unlink(STATE_FILE).catch(() => {});
      process.exit(0);
    }

    const dbFile = Bun.file(DB_PATH);
    if (await dbFile.exists()) {
      const { ExpBaseStorage } = await import("../src/storage/expbase.js");
      const storage = new ExpBaseStorage({ dbPath: DB_PATH });
      const outcome = inferOutcome(state.toolCalls);

      const durationMs =
        state.toolCalls.length > 0
          ? Date.now() - new Date(state.startTime).getTime()
          : 0;

      const trace = storage.addTrace({
        task_summary: extractTaskSummary(state.prompts || []),
        problem_description: extractProblemDescription(
          state.prompts || [],
          state.toolCalls,
        ),
        tool_calls: state.toolCalls,
        intermediate_thoughts: state.prompts || [],
        final_answer: `Session ended with ${outcome.status}`,
        outcome,
        duration_ms: durationMs,
        model_used: process.env.CLAUDE_MODEL || "unknown",
        session_id: sessionId,
        agent_id: process.env.CLAUDE_AGENT_ID,
      });

      storage.close();
      if (VERBOSE) console.error(`[evolver] Saved trace: ${trace.id}`);
    }

    await unlink(STATE_FILE).catch(() => {});
  } catch (e) {
    if (VERBOSE) console.error("[evolver]", e);
    await unlink(STATE_FILE).catch(() => {});
  }
  process.exit(0);
}

main();

