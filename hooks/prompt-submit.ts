#!/usr/bin/env bun
/**
 * UserPromptSubmit Hook - Task-aware principle retrieval
 */

import { homedir } from "node:os";
import { join } from "node:path";

const DB_PATH =
  process.env.EVOLVER_DB_PATH || join(homedir(), ".evolver", "expbase.db");
const STATE_FILE =
  process.env.EVOLVER_STATE_FILE ||
  join(homedir(), ".evolver", "session-state.json");
const VERBOSE = process.env.EVOLVER_VERBOSE === "true";
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

    // Store prompt in session state for task extraction
    const sessionId = input?.session_id || process.env.EVOLVER_SESSION_ID;
    if (sessionId) {
      const stateFile = Bun.file(STATE_FILE);
      try {
        let state = { sessionId, prompts: [] as string[], toolCalls: [] };
        if (await stateFile.exists()) {
          const existing = await stateFile.json().catch(() => null);
          if (existing?.sessionId === sessionId) state = existing;
        }
        if (!state.prompts) state.prompts = [];
        state.prompts.push(prompt);
        await Bun.write(STATE_FILE, JSON.stringify(state, null, 2));
      } catch {
        // Ignore state write errors
      }
    }

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

