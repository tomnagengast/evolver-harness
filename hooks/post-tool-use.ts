#!/usr/bin/env bun
/**
 * PostToolUse Hook - Logs tool calls to session state
 */

import { homedir } from "node:os";
import { join } from "node:path";

/** Expand ~ to home directory in paths */
const expandTilde = (p: string) =>
  p.startsWith("~/") ? join(homedir(), p.slice(2)) : p;

const STATE_DIR = expandTilde(
  process.env.EVOLVER_STATE_DIR || join(homedir(), ".evolver", "sessions"),
);
const VERBOSE = process.env.EVOLVER_VERBOSE === "true";

/** Get session-specific state file path */
const getStateFile = (sessionId: string) => join(STATE_DIR, `${sessionId}.json`);

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

function truncate(value: unknown, maxLen = 5000): unknown {
  if (typeof value === "string" && value.length > maxLen) {
    return `${value.slice(0, maxLen)}... [truncated]`;
  }
  if (typeof value === "object" && value !== null) {
    const str = JSON.stringify(value);
    if (str.length > maxLen)
      return { _truncated: true, preview: str.slice(0, 500) };
  }
  return value;
}

async function main() {
  try {
    const input = await Bun.stdin.json().catch(() => null);
    if (!input?.tool_name) process.exit(0);

    const sessionId =
      input.session_id || process.env.EVOLVER_SESSION_ID || "unknown";
    if (sessionId === "unknown") process.exit(0);

    const stateFilePath = getStateFile(sessionId);
    const stateFile = Bun.file(stateFilePath);

    let state: SessionState = {
      sessionId,
      startTime: new Date().toISOString(),
      toolCalls: [],
    };

    if (await stateFile.exists()) {
      const existing = (await stateFile
        .json()
        .catch(() => null)) as SessionState | null;
      if (existing) state = existing;
    }

    state.toolCalls.push({
      tool: input.tool_name,
      input: input.tool_input || {},
      output: truncate(input.tool_response),
      timestamp: new Date().toISOString(),
    });

    await Bun.write(stateFilePath, JSON.stringify(state, null, 2));

    if (VERBOSE)
      console.error(
        `[evolver] Logged: ${input.tool_name} (${state.toolCalls.length} total)`,
      );
  } catch (e) {
    if (VERBOSE) console.error("[evolver]", e);
  }
  process.exit(0);
}

main();
