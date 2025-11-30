#!/usr/bin/env bun
/**
 * PostToolUse Hook - Logs tool calls to session state
 */

import { homedir } from "node:os";
import { join } from "node:path";

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
    const stateFile = Bun.file(STATE_FILE);

    let state: SessionState = {
      sessionId,
      startTime: new Date().toISOString(),
      toolCalls: [],
    };

    if (await stateFile.exists()) {
      const existing = (await stateFile
        .json()
        .catch(() => null)) as SessionState | null;
      if (existing?.sessionId === sessionId) state = existing;
    }

    state.toolCalls.push({
      tool: input.tool_name,
      input: input.tool_input || {},
      output: truncate(input.tool_response),
      timestamp: new Date().toISOString(),
    });

    await Bun.write(STATE_FILE, JSON.stringify(state, null, 2));

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
