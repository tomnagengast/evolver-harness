#!/usr/bin/env bun
/**
 * PostToolUse Hook - Logs tool calls with success detection and principle context
 */

import { homedir } from "node:os";
import { join } from "node:path";
import type { UserFeedback } from "../src/types.js";

// Load .env file from project directory
const envFile = Bun.file(join(import.meta.dir, "../.env"));
if (await envFile.exists()) {
  const envContent = await envFile.text();
  for (const line of envContent.split("\n")) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith("#")) {
      const [key, ...valueParts] = trimmed.split("=");
      const value = valueParts.join("=");
      if (key && value && !process.env[key]) {
        process.env[key] = value;
      }
    }
  }
}

/** Expand ~ to home directory in paths */
const expandTilde = (p: string) =>
  p.startsWith("~/") ? join(homedir(), p.slice(2)) : p;

const STATE_DIR = expandTilde(
  process.env.EVOLVER_STATE_DIR || join(homedir(), ".evolver", "sessions"),
);
const VERBOSE = process.env.EVOLVER_VERBOSE === "true";

/** Get session-specific state file path */
const getStateFile = (sessionId: string) =>
  join(STATE_DIR, `${sessionId}.json`);

interface EnrichedToolCall {
  tool: string;
  input: Record<string, unknown>;
  output: unknown;
  timestamp: string;
  succeeded: boolean;
  active_principles: string[];
  prompt_index: number;
}

interface SessionState {
  sessionId: string;
  startTime: string;
  prompts?: string[];
  injectedPrinciples?: string[];
  userFeedback?: UserFeedback[];
  toolCalls: EnrichedToolCall[];
}

/** Determine if a tool call succeeded based on output patterns */
function determineToolSuccess(toolName: string, output: unknown): boolean {
  const outStr =
    typeof output === "string" ? output : JSON.stringify(output ?? "");

  // Check for common error patterns
  if (
    /\b(error|failed|exception|denied|refused|cannot|unable)\b/i.test(outStr)
  ) {
    // But not if it's just discussing errors (e.g., "fix the error")
    if (!/\b(fix|fixing|found|check|looking)\b/i.test(outStr)) {
      return false;
    }
  }

  // Tool-specific success heuristics
  switch (toolName) {
    case "Bash":
      // Check for exit code indicators
      if (/exit code[:\s]+[1-9]/i.test(outStr)) return false;
      if (/command not found/i.test(outStr)) return false;
      break;
    case "Edit":
    case "Write":
      // Edit/Write failures usually have explicit error messages
      if (/\b(file not found|permission denied|no such file)\b/i.test(outStr)) {
        return false;
      }
      break;
    case "Read":
      if (/\b(file not found|does not exist|no such file)\b/i.test(outStr)) {
        return false;
      }
      break;
  }

  return true;
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

    // Determine tool success
    const succeeded = determineToolSuccess(
      input.tool_name,
      input.tool_response,
    );

    // Get current prompt index (prompts array length - 1, or 0 if none)
    const promptIndex = Math.max(0, (state.prompts?.length || 1) - 1);

    // Get currently active principles
    const activePrinciples = state.injectedPrinciples || [];

    const enrichedCall: EnrichedToolCall = {
      tool: input.tool_name,
      input: input.tool_input || {},
      output: truncate(input.tool_response),
      timestamp: new Date().toISOString(),
      succeeded,
      active_principles: [...activePrinciples],
      prompt_index: promptIndex,
    };

    state.toolCalls.push(enrichedCall);

    await Bun.write(stateFilePath, JSON.stringify(state, null, 2));

    if (VERBOSE) {
      const successStr = succeeded ? "ok" : "FAIL";
      console.error(
        `[evolver] Logged: ${input.tool_name} [${successStr}] (${state.toolCalls.length} total, ${activePrinciples.length} principles active)`,
      );
    }
  } catch (e) {
    if (VERBOSE) console.error("[evolver]", e);
  }
  process.exit(0);
}

main();
