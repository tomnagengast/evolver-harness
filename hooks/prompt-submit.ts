#!/usr/bin/env bun
/**
 * UserPromptSubmit Hook - Task-aware principle retrieval
 */

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

    // Store prompt and injected principle IDs in session state
    const sessionId = input?.session_id || process.env.EVOLVER_SESSION_ID;
    if (sessionId) {
      const stateFile = Bun.file(getStateFile(sessionId));
      try {
        let state = {
          sessionId,
          prompts: [] as string[],
          toolCalls: [] as unknown[],
          injectedPrinciples: [] as string[],
        };
        if (await stateFile.exists()) {
          const existing = await stateFile.json().catch(() => null);
          if (existing) state = existing;
        }
        if (!state.prompts) state.prompts = [];
        if (!state.injectedPrinciples) state.injectedPrinciples = [];
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
