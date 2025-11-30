#!/usr/bin/env bun

/**
 * SessionEnd Hook - Saves trace with multi-dimensional scoring and credit assignment
 */

import { unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type {
  EnrichedTraceOutcome,
  OutcomeSignals,
  PrincipleCredit,
  UserFeedback,
} from "../src/types.js";

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

interface EnrichedToolCall {
  tool: string;
  input: Record<string, unknown>;
  output: unknown;
  timestamp: string;
  succeeded?: boolean;
  active_principles?: string[];
  prompt_index?: number;
}

interface SessionState {
  sessionId: string;
  startTime: string;
  prompts?: string[];
  injectedPrinciples?: string[];
  userFeedback?: UserFeedback[];
  toolCalls: EnrichedToolCall[];
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

/** Compute multi-dimensional outcome signals from session state */
function computeOutcomeSignals(state: SessionState): OutcomeSignals {
  const toolCalls = state.toolCalls || [];
  const userFeedback = state.userFeedback || [];

  // Tool success rate (use succeeded field if available, else infer from output)
  const toolsWithSuccess = toolCalls.filter((tc) => tc.succeeded !== undefined);
  let tool_success_rate: number;
  if (toolsWithSuccess.length > 0) {
    tool_success_rate =
      toolsWithSuccess.filter((tc) => tc.succeeded).length /
      toolsWithSuccess.length;
  } else {
    // Fall back to error pattern matching
    const succeededTools = toolCalls.filter((tc) => {
      const out =
        typeof tc.output === "string" ? tc.output : JSON.stringify(tc.output);
      return !/error|failed/i.test(out);
    });
    tool_success_rate =
      toolCalls.length > 0 ? succeededTools.length / toolCalls.length : 1;
  }

  // Error count
  const error_count = toolCalls.filter((tc) => {
    if (tc.succeeded === false) return true;
    const out =
      typeof tc.output === "string" ? tc.output : JSON.stringify(tc.output);
    return /error|failed/i.test(out);
  }).length;

  // Edit metrics
  const editTools = ["Edit", "Write", "NotebookEdit"];
  const edits = toolCalls.filter((tc) => editTools.includes(tc.tool));
  const made_edits = edits.length > 0;
  const edit_count = edits.length;

  // Files touched
  const files = new Set<string>();
  for (const tc of edits) {
    const filePath =
      (tc.input?.file_path as string) || (tc.input?.path as string);
    if (filePath) files.add(filePath);
  }
  const files_touched = files.size;

  // User feedback average sentiment
  const avg_sentiment =
    userFeedback.length > 0
      ? userFeedback.reduce((sum, f) => sum + f.sentiment, 0) /
        userFeedback.length
      : 0.5;

  return {
    tool_success_rate,
    error_count,
    made_edits,
    edit_count,
    files_touched,
    user_feedback: userFeedback,
    avg_sentiment,
    session_continued: toolCalls.length > 0,
    prompt_count: state.prompts?.length || 0,
  };
}

/** Compute enriched outcome with multi-dimensional scoring */
function inferEnrichedOutcome(state: SessionState): EnrichedTraceOutcome {
  const signals = computeOutcomeSignals(state);

  // Weighted score from multiple dimensions
  const weights = {
    tool_success: 0.25,
    user_sentiment: 0.35,
    made_edits: 0.2,
    no_errors: 0.2,
  };

  const score =
    weights.tool_success * signals.tool_success_rate +
    weights.user_sentiment * signals.avg_sentiment +
    weights.made_edits * (signals.made_edits ? 0.8 : 0.3) +
    weights.no_errors *
      (signals.error_count === 0
        ? 1
        : Math.max(0, 1 - signals.error_count * 0.15));

  // Determine status from score
  let status: "success" | "failure" | "partial";
  if (score >= 0.6) status = "success";
  else if (score <= 0.35) status = "failure";
  else status = "partial";

  return {
    status,
    score,
    signals,
    principle_credits: [], // Filled in by calculatePrincipleCredits
  };
}

/** Calculate per-principle credit based on tool success and user feedback */
function calculatePrincipleCredits(
  state: SessionState,
  outcome: EnrichedTraceOutcome,
): PrincipleCredit[] {
  const credits: PrincipleCredit[] = [];
  const principleIds = state.injectedPrinciples || [];

  if (principleIds.length === 0) return credits;

  // Build principle -> tool success mapping
  const principleStats = new Map<
    string,
    { succeeded: number; failed: number; total: number }
  >();

  for (const pId of principleIds) {
    principleStats.set(pId, { succeeded: 0, failed: 0, total: 0 });
  }

  // For each tool call, credit active principles
  for (const tc of state.toolCalls || []) {
    // Use active_principles if available, else assume all principles were active
    const activePrinciples = tc.active_principles || principleIds;
    for (const pId of activePrinciples) {
      const stats = principleStats.get(pId);
      if (stats) {
        stats.total++;
        if (tc.succeeded !== false) stats.succeeded++;
        else stats.failed++;
      }
    }
  }

  // Calculate credit for each principle
  for (const pId of principleIds) {
    const stats = principleStats.get(pId);
    if (!stats) continue;
    const reasons: string[] = [];

    // Base credit from outcome
    let credit = outcome.score;

    // Adjust by tool success rate for this principle
    if (stats.total > 0) {
      const principleToolRate = stats.succeeded / stats.total;
      credit = credit * 0.6 + principleToolRate * 0.4;
      reasons.push(`tools=${(principleToolRate * 100).toFixed(0)}%`);
    }

    // Boost/penalize based on user feedback
    const feedback = outcome.signals.user_feedback;
    if (feedback.length > 0) {
      const avgSentiment =
        feedback.reduce((s, f) => s + f.sentiment, 0) / feedback.length;
      credit = credit * 0.7 + avgSentiment * 0.3;
      reasons.push(`sentiment=${(avgSentiment * 100).toFixed(0)}%`);
    }

    credits.push({
      principle_id: pId,
      credit: Math.max(0, Math.min(1, credit)),
      reasoning: reasons.join(", ") || "base_outcome",
    });
  }

  return credits;
}

/** Legacy inferOutcome for backward compatibility with trace storage */
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

      // Compute enriched outcome with multi-dimensional signals
      const enrichedOutcome = inferEnrichedOutcome(state);

      // Calculate per-principle credits
      const credits = calculatePrincipleCredits(state, enrichedOutcome);
      enrichedOutcome.principle_credits = credits;

      // Use legacy outcome for trace storage (backward compat)
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
        final_answer: `Session ended with ${enrichedOutcome.status} (score: ${enrichedOutcome.score.toFixed(2)})`,
        outcome,
        duration_ms: durationMs,
        model_used: process.env.CLAUDE_MODEL || "unknown",
        session_id: sessionId,
        agent_id: process.env.CLAUDE_AGENT_ID,
      });

      if (VERBOSE) {
        console.error(`[evolver] Saved trace: ${trace.id}`);
        console.error(
          `[evolver] Outcome: ${enrichedOutcome.status} (score=${enrichedOutcome.score.toFixed(2)}, ` +
            `tools=${(enrichedOutcome.signals.tool_success_rate * 100).toFixed(0)}%, ` +
            `sentiment=${(enrichedOutcome.signals.avg_sentiment * 100).toFixed(0)}%)`,
        );
      }

      // Record weighted credit for each principle
      if (credits.length > 0) {
        for (const { principle_id, credit, reasoning } of credits) {
          try {
            storage.recordUsage(principle_id, trace.id, credit);
            if (VERBOSE) {
              console.error(
                `[evolver] ${principle_id}: credit=${credit.toFixed(2)} (${reasoning})`,
              );
            }
          } catch {
            // Principle may have been deleted, ignore
          }
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
