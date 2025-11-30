#!/usr/bin/env bun

/**
 * SessionEnd Hook - Saves trace to ExpBase
 */

import { unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

/** Expand ~ to home directory in paths */
const expandTilde = (p: string) =>
  p.startsWith("~/") ? join(homedir(), p.slice(2)) : p;

const DB_PATH = expandTilde(
  process.env.EVOLVER_DB_PATH || join(homedir(), ".evolver", "expbase.db"),
);
const STATE_DIR = expandTilde(
  process.env.EVOLVER_STATE_DIR || join(homedir(), ".evolver", "sessions"),
);
const VERBOSE = process.env.EVOLVER_VERBOSE === "true";

/** Get session-specific state file path */
const getStateFile = (sessionId: string) =>
  join(STATE_DIR, `${sessionId}.json`);
const AUTO_DISTILL = process.env.EVOLVER_AUTO_DISTILL !== "false";
const DISTILL_THRESHOLD = Number.parseInt(
  process.env.EVOLVER_AUTO_DISTILL_THRESHOLD || "5",
  10,
);

interface SessionState {
  sessionId: string;
  startTime: string;
  prompts?: string[];
  injectedPrinciples?: string[];
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

/**
 * Count undistilled traces (traces not referenced in any principle's examples)
 */
function countUndistilledTraces(storage: {
  getAllTraces: () => Array<{ id: string }>;
  getAllPrinciples: () => Array<{ examples: Array<{ trace_id: string }> }>;
}): number {
  const traces = storage.getAllTraces();
  const principles = storage.getAllPrinciples();

  const referencedTraceIds = new Set<string>();
  for (const principle of principles) {
    for (const example of principle.examples) {
      referencedTraceIds.add(example.trace_id);
    }
  }

  return traces.filter((t) => !referencedTraceIds.has(t.id)).length;
}

/**
 * Spawn background distillation process (fire-and-forget)
 */
function spawnDistillation(count: number): void {
  const distillerPath = join(import.meta.dir, "../src/distiller/cli.ts");

  Bun.spawn(["bun", distillerPath, "distill", String(count)], {
    env: {
      ...process.env,
      EVOLVER_DB_PATH: DB_PATH,
    },
    stdout: VERBOSE ? "inherit" : "ignore",
    stderr: VERBOSE ? "inherit" : "ignore",
  });

  if (VERBOSE)
    console.error(
      `[evolver] Spawned background distillation for ${count} traces`,
    );
}

async function main() {
  try {
    const input = await Bun.stdin.json().catch(() => null);
    const sessionId =
      input?.session_id || process.env.EVOLVER_SESSION_ID || "unknown";

    const stateFilePath = getStateFile(sessionId);
    const stateFile = Bun.file(stateFilePath);
    if (!(await stateFile.exists())) process.exit(0);

    const state = (await stateFile.json()) as SessionState;

    // Skip trace save on clear
    if (input?.reason === "clear") {
      await unlink(stateFilePath).catch(() => {});
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

      if (VERBOSE) console.error(`[evolver] Saved trace: ${trace.id}`);

      // Record usage for all injected principles
      const wasSuccessful = outcome.status === "success";
      if (state.injectedPrinciples && state.injectedPrinciples.length > 0) {
        for (const principleId of state.injectedPrinciples) {
          try {
            storage.recordUsage(principleId, trace.id, wasSuccessful);
          } catch {
            // Principle may have been deleted, ignore
          }
        }
        if (VERBOSE) {
          console.error(
            `[evolver] Recorded usage for ${state.injectedPrinciples.length} principles (success: ${wasSuccessful})`,
          );
        }
      }

      // Auto-distill if enabled and threshold reached
      if (AUTO_DISTILL) {
        const undistilledCount = countUndistilledTraces(storage);
        if (undistilledCount >= DISTILL_THRESHOLD) {
          spawnDistillation(undistilledCount);
        }
      }

      storage.close();
    }

    await unlink(stateFilePath).catch(() => {});
  } catch (e) {
    if (VERBOSE) console.error("[evolver]", e);
    // Try to clean up state file if we have a session ID
    const sessionId = process.env.EVOLVER_SESSION_ID || "unknown";
    if (sessionId !== "unknown") {
      await unlink(getStateFile(sessionId)).catch(() => {});
    }
  }
  process.exit(0);
}

main();
