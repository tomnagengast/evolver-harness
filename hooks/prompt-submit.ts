#!/usr/bin/env bun
/**
 * UserPromptSubmit Hook - Task-aware principle retrieval + user feedback capture
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
const MAX_PRINCIPLES = Number.parseInt(
  process.env.EVOLVER_PROMPT_MAX_PRINCIPLES || "5",
  10,
);
const MIN_SCORE = Number.parseFloat(
  process.env.EVOLVER_PROMPT_MIN_SCORE || "0.5",
);

const STOP_WORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "but",
  "in",
  "on",
  "at",
  "to",
  "for",
  "with",
  "is",
  "are",
  "was",
  "were",
  "be",
  "have",
  "has",
  "do",
  "does",
  "did",
  "will",
  "would",
  "could",
  "should",
  "can",
  "this",
  "that",
  "i",
  "you",
  "it",
  "we",
  "they",
  "what",
  "which",
  "who",
  "when",
  "where",
  "why",
  "how",
  "all",
  "some",
  "no",
  "not",
  "only",
  "so",
  "than",
  "too",
  "very",
  "just",
  "also",
  "now",
  "please",
  "help",
  "me",
  "my",
]);

/** Patterns for detecting explicit user feedback */
const FEEDBACK_PATTERNS = {
  explicit_positive: [
    /\b(thanks|thank you|perfect|great|awesome|works|excellent|nice|good job|well done|thx|ty)\b/i,
    /^(yes|yep|yeah|correct|exactly|right)[.!]?$/i,
    /\bthat('s| is) (right|correct|perfect|great|exactly what)\b/i,
  ],
  explicit_negative: [
    /\b(wrong|incorrect|undo|revert|rollback|broken|failed|doesn't work|didn't work)\b/i,
    /\b(try again|start over|that's not|not what i|go back)\b/i,
    /^no[,.\s]|^nope\b/i,
  ],
};

/** Compute keyword overlap (Jaccard similarity) between two strings */
function computeKeywordOverlap(a: string, b: string): number {
  const wordsA = new Set(
    a
      .toLowerCase()
      .split(/\W+/)
      .filter((w) => w.length > 3 && !STOP_WORDS.has(w)),
  );
  const wordsB = new Set(
    b
      .toLowerCase()
      .split(/\W+/)
      .filter((w) => w.length > 3 && !STOP_WORDS.has(w)),
  );
  if (wordsA.size === 0 || wordsB.size === 0) return 0;

  const intersection = [...wordsA].filter((w) => wordsB.has(w)).length;
  const union = new Set([...wordsA, ...wordsB]).size;
  return intersection / union;
}

/** Analyze user feedback from current prompt based on previous context */
function analyzeUserFeedback(
  currentPrompt: string,
  previousPrompts: string[],
  hasRecentToolCalls: boolean,
): UserFeedback {
  const promptIndex = previousPrompts.length;

  // Check explicit positive
  for (const pattern of FEEDBACK_PATTERNS.explicit_positive) {
    if (pattern.test(currentPrompt)) {
      return {
        sentiment: 1.0,
        type: "explicit_positive",
        confidence: 0.9,
        prompt_index: promptIndex,
        matched_patterns: [pattern.source],
      };
    }
  }

  // Check explicit negative
  for (const pattern of FEEDBACK_PATTERNS.explicit_negative) {
    if (pattern.test(currentPrompt)) {
      return {
        sentiment: 0.0,
        type: "explicit_negative",
        confidence: 0.9,
        prompt_index: promptIndex,
        matched_patterns: [pattern.source],
      };
    }
  }

  // Check implicit retry (similar to recent request)
  if (previousPrompts.length > 0) {
    const lastPrompt = previousPrompts[previousPrompts.length - 1];
    const similarity = computeKeywordOverlap(currentPrompt, lastPrompt);
    if (similarity > 0.6) {
      return {
        sentiment: 0.2,
        type: "implicit_retry",
        confidence: 0.7,
        prompt_index: promptIndex,
      };
    }
  }

  // Check implicit continuation (new unrelated task = previous succeeded)
  if (previousPrompts.length > 0 && hasRecentToolCalls) {
    const lastPrompt = previousPrompts[previousPrompts.length - 1];
    const similarity = computeKeywordOverlap(currentPrompt, lastPrompt);
    if (similarity < 0.2) {
      return {
        sentiment: 0.7,
        type: "implicit_continuation",
        confidence: 0.6,
        prompt_index: promptIndex,
      };
    }
  }

  return {
    sentiment: 0.5,
    type: "neutral",
    confidence: 0.5,
    prompt_index: promptIndex,
  };
}

async function main() {
  try {
    const input = await Bun.stdin.json().catch(() => null);
    const prompt = input?.prompt;

    // Skip short/confirmation prompts
    if (
      !prompt ||
      prompt.length < 20 ||
      /^(yes|no|ok|okay|sure|continue|y|n)\.?$/i.test(prompt.trim())
    ) {
      process.exit(0);
    }

    // Extract keywords
    const keywords = [
      ...new Set(
        prompt
          .toLowerCase()
          .replace(/[^a-z0-9\s]/g, " ")
          .split(/\s+/)
          .filter((w: string) => w.length > 2 && !STOP_WORDS.has(w)),
      ),
    ];

    if (keywords.length === 0) process.exit(0);

    const dbFile = Bun.file(DB_PATH);
    if (!(await dbFile.exists())) process.exit(0);

    const { ExpBaseStorage } = await import("../src/storage/expbase.js");
    const storage = new ExpBaseStorage({ dbPath: DB_PATH });

    const results = storage.searchPrinciples({
      tags: keywords,
      limit: MAX_PRINCIPLES * 2,
      min_principle_score: MIN_SCORE,
      search_mode: "principles",
    });

    storage.close();

    const principles = results
      .map((p) => ({ p, score: (p.success_count + 1) / (p.use_count + 2) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_PRINCIPLES);

    // Store prompt, feedback, and injected principle IDs in session state
    const sessionId = input?.session_id || process.env.EVOLVER_SESSION_ID;
    if (sessionId) {
      const stateFile = Bun.file(getStateFile(sessionId));
      try {
        let state = {
          sessionId,
          prompts: [] as string[],
          toolCalls: [] as unknown[],
          injectedPrinciples: [] as string[],
          userFeedback: [] as UserFeedback[],
        };
        if (await stateFile.exists()) {
          const existing = await stateFile.json().catch(() => null);
          if (existing) state = existing;
        }
        if (!state.prompts) state.prompts = [];
        if (!state.injectedPrinciples) state.injectedPrinciples = [];
        if (!state.userFeedback) state.userFeedback = [];

        // Analyze user feedback from this prompt (about previous output)
        const hasRecentToolCalls = (state.toolCalls?.length || 0) > 0;
        const feedback = analyzeUserFeedback(
          prompt,
          state.prompts,
          hasRecentToolCalls,
        );

        // Only store non-neutral feedback to reduce noise
        if (feedback.type !== "neutral") {
          state.userFeedback.push(feedback);
          if (VERBOSE) {
            console.error(
              `[evolver] Feedback: ${feedback.type} (sentiment=${feedback.sentiment.toFixed(2)})`,
            );
          }
        }

        state.prompts.push(prompt);
        // Add any new principle IDs (deduped)
        const newIds = principles.map(({ p }) => p.id);
        state.injectedPrinciples = [
          ...new Set([...state.injectedPrinciples, ...newIds]),
        ];
        await Bun.write(
          getStateFile(sessionId),
          JSON.stringify(state, null, 2),
        );
      } catch {
        // Ignore state write errors
      }
    }

    if (principles.length === 0) process.exit(0);

    const context = principles
      .map(
        ({ p, score }) =>
          `- **${p.tags[0] || "general"}** (${score.toFixed(2)}): ${p.text}`,
      )
      .join("\n");

    console.log(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "UserPromptSubmit",
          additionalContext: `\n**Relevant principles:**\n${context}\n`,
        },
      }),
    );
  } catch (e) {
    if (VERBOSE) console.error("[evolver]", e);
  }
  process.exit(0);
}

main();
