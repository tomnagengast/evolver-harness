#!/usr/bin/env bun
/**
 * SessionStart Hook - Retrieves principles and injects them as context
 */

import { homedir } from "node:os";
import { join } from "node:path";

/** Expand ~ to home directory in paths */
const expandTilde = (p: string) =>
  p.startsWith("~/") ? join(homedir(), p.slice(2)) : p;

const DB_PATH = expandTilde(
  process.env.EVOLVER_DB_PATH || join(homedir(), ".evolver", "expbase.db"),
);
const STATE_FILE = expandTilde(
  process.env.EVOLVER_STATE_FILE ||
    join(homedir(), ".evolver", "session-state.json"),
);
const VERBOSE = process.env.EVOLVER_VERBOSE === "true";
const MAX_PRINCIPLES = Number.parseInt(
  process.env.EVOLVER_MAX_PRINCIPLES || "10",
  10,
);
const MIN_SCORE = Number.parseFloat(process.env.EVOLVER_MIN_SCORE || "0.5");

interface Principle {
  id: string;
  text: string;
  tags: string[];
  use_count: number;
  success_count: number;
}

async function main() {
  try {
    const input = await Bun.stdin.json().catch(() => null);

    // Skip on resume
    if (input?.source === "resume") {
      process.exit(0);
    }

    const sessionId = input?.session_id || crypto.randomUUID();

    // Persist env vars if CLAUDE_ENV_FILE is set
    const envFile = process.env.CLAUDE_ENV_FILE;
    if (envFile) {
      await Bun.write(
        envFile,
        `export EVOLVER_SESSION_ID="${sessionId}"\nexport EVOLVER_DB_PATH="${DB_PATH}"\n`,
        { append: true },
      );
    }

    // Get principles
    const dbFile = Bun.file(DB_PATH);
    if (!(await dbFile.exists())) {
      console.log(`# Evolver\n\nNo experience base found at ${DB_PATH}`);
      process.exit(0);
    }

    const { ExpBaseStorage } = await import("../src/storage/expbase.js");
    const storage = new ExpBaseStorage({ dbPath: DB_PATH });

    const principles: Principle[] = storage
      .getPrincipleScores()
      .filter((s) => s.score >= MIN_SCORE)
      .slice(0, MAX_PRINCIPLES)
      .map((s) => storage.getPrinciple(s.id))
      .filter(Boolean) as Principle[];

    storage.close();

    // Initialize session state with injected principle IDs
    const principleIds = principles.map((p) => p.id);
    if (principleIds.length > 0) {
      const state = {
        sessionId,
        startTime: new Date().toISOString(),
        injectedPrinciples: principleIds,
        prompts: [] as string[],
        toolCalls: [] as unknown[],
      };
      await Bun.write(STATE_FILE, JSON.stringify(state, null, 2));
    }

    // Output context
    const lines = [
      "# Evolver Experience Context",
      "",
      `Session: ${sessionId}`,
      "",
    ];

    if (principles.length > 0) {
      lines.push("## Retrieved Principles", "");
      for (const p of principles) {
        const score = (p.success_count + 1) / (p.use_count + 2);
        lines.push(`**[${p.id}]** (score: ${score.toFixed(2)})`);
        lines.push(p.text);
        lines.push(`Tags: ${p.tags.join(", ")}`, "---", "");
      }
    } else {
      lines.push("No high-scoring principles found.");
    }

    console.log(lines.join("\n"));
  } catch (e) {
    if (VERBOSE) console.error("[evolver]", e);
  }
  process.exit(0);
}

main();
