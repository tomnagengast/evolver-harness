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
  toolCalls: Array<{
    tool: string;
    input: unknown;
    output: unknown;
    timestamp: string;
  }>;
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

      const trace = storage.addTrace({
        task_summary: "Claude Code session",
        problem_description: `Session with ${state.toolCalls.length} tool calls`,
        tool_calls: state.toolCalls,
        thoughts: [],
        final_answer: `Session ended with ${outcome.status}`,
        outcome,
        model_used: process.env.CLAUDE_MODEL,
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

