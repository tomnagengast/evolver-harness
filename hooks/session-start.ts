#!/usr/bin/env bun
/**
 * SessionStart Hook - Retrieves principles and injects them as context
 * Includes contextual retrieval based on git history and project type
 */

import { homedir } from "node:os";
import { join } from "node:path";

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
import { $ } from "bun";

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
  process.env.EVOLVER_MAX_PRINCIPLES || "10",
  10,
);
const MIN_SCORE = Number.parseFloat(process.env.EVOLVER_MIN_SCORE || "0.5");
const EXPLORATION_SLOTS = 2; // Reserved slots for untested principles

interface Principle {
  id: string;
  text: string;
  tags: string[];
  use_count: number;
  success_count: number;
}

interface RetrievalContext {
  recentCommits: string[];
  changedFiles: string[];
  projectTags: string[];
}

/** Gather context from git history and project files */
async function gatherContext(cwd: string): Promise<RetrievalContext> {
  const context: RetrievalContext = {
    recentCommits: [],
    changedFiles: [],
    projectTags: [],
  };

  // 1. Git history analysis
  try {
    const gitLog = await $`git -C ${cwd} log --oneline -5 --format=%s`
      .text()
      .catch(() => "");
    context.recentCommits = gitLog.trim().split("\n").filter(Boolean);

    const gitDiff = await $`git -C ${cwd} diff --name-only HEAD~5 HEAD`
      .text()
      .catch(() => "");
    context.changedFiles = gitDiff.trim().split("\n").filter(Boolean);
  } catch {
    /* not a git repo */
  }

  // 2. Project type inference from package.json
  const pkgJson = Bun.file(join(cwd, "package.json"));
  if (await pkgJson.exists()) {
    try {
      const pkg = await pkgJson.json();
      const deps = Object.keys(pkg.dependencies || {});
      const devDeps = Object.keys(pkg.devDependencies || {});
      const allDeps = [...deps, ...devDeps];

      // Framework/library detection
      if (allDeps.includes("react"))
        context.projectTags.push("react", "frontend");
      if (allDeps.includes("vue")) context.projectTags.push("vue", "frontend");
      if (allDeps.includes("express"))
        context.projectTags.push("express", "backend", "api");
      if (allDeps.includes("fastify"))
        context.projectTags.push("fastify", "backend", "api");
      if (allDeps.includes("next"))
        context.projectTags.push("next", "react", "fullstack");
      if (allDeps.includes("typescript"))
        context.projectTags.push("typescript");
      if (allDeps.includes("jest") || allDeps.includes("vitest"))
        context.projectTags.push("testing");
      if (allDeps.includes("prisma") || allDeps.includes("drizzle-orm"))
        context.projectTags.push("database", "orm");
    } catch {
      /* invalid package.json */
    }
  }

  // 3. Extract keywords from recent commits
  const commitKeywords = extractKeywords(context.recentCommits.join(" "));
  context.projectTags.push(...commitKeywords);

  return context;
}

/** Extract relevant keywords from text */
function extractKeywords(text: string): string[] {
  const keywords: string[] = [];
  const lower = text.toLowerCase();

  // Common task patterns
  if (lower.includes("fix") || lower.includes("bug"))
    keywords.push("debugging");
  if (lower.includes("test")) keywords.push("testing");
  if (lower.includes("refactor")) keywords.push("refactoring");
  if (lower.includes("api") || lower.includes("endpoint")) keywords.push("api");
  if (lower.includes("auth")) keywords.push("authentication");
  if (lower.includes("perf") || lower.includes("optim"))
    keywords.push("performance");

  return keywords;
}

async function main() {
  try {
    const input = await Bun.stdin.json().catch(() => null);

    // Skip on resume
    if (input?.source === "resume") {
      process.exit(0);
    }

    const sessionId = input?.session_id || crypto.randomUUID();
    const cwd = input?.cwd || process.cwd();

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

    // Gather project context for contextual retrieval
    const context = await gatherContext(cwd);
    const contextTags = [...new Set(context.projectTags)];

    // Get all principle scores
    const allScores = storage.getPrincipleScores();

    // Score principles with context boosting
    const scoredPrinciples = allScores.map(({ principle, score }) => {
      let contextBoost = 0;
      for (const tag of principle.tags) {
        if (contextTags.includes(tag)) contextBoost += 0.1;
      }
      return { principle, finalScore: score + contextBoost };
    });

    // Get high-scoring principles (reserving slots for exploration)
    const mainSlots = MAX_PRINCIPLES - EXPLORATION_SLOTS;
    const mainPrinciples = scoredPrinciples
      .filter((s) => s.finalScore >= MIN_SCORE)
      .sort((a, b) => b.finalScore - a.finalScore)
      .slice(0, mainSlots)
      .map((s) => s.principle) as Principle[];

    // Get exploratory principles (untested or under-tested)
    const exploratoryPrinciples =
      storage.getExploratoryPrinciples(EXPLORATION_SLOTS);

    // Combine and dedupe
    const mainIds = new Set(mainPrinciples.map((p) => p.id));
    const uniqueExploratory = exploratoryPrinciples.filter(
      (p) => !mainIds.has(p.id),
    );
    const allPrinciples = [...mainPrinciples, ...uniqueExploratory].slice(
      0,
      MAX_PRINCIPLES,
    );

    // Track which principles are exploratory for output
    const exploratoryIds = new Set(uniqueExploratory.map((p) => p.id));

    storage.close();

    // Initialize session state with injected principle IDs
    const principleIds = allPrinciples.map((p) => p.id);
    const state = {
      sessionId,
      startTime: new Date().toISOString(),
      injectedPrinciples: principleIds,
      exploratoryPrinciples: [...exploratoryIds],
      contextTags,
      prompts: [] as string[],
      toolCalls: [] as unknown[],
    };
    // Ensure state directory exists
    const { mkdir } = await import("node:fs/promises");
    await mkdir(STATE_DIR, { recursive: true });
    await Bun.write(getStateFile(sessionId), JSON.stringify(state, null, 2));

    // Output context
    const lines = [
      "# Evolver Experience Context",
      "",
      `Session: ${sessionId}`,
      "",
    ];

    if (allPrinciples.length > 0) {
      lines.push("## Retrieved Principles", "");
      for (const p of allPrinciples) {
        const score = (p.success_count + 1) / (p.use_count + 2);
        const isExploratory = exploratoryIds.has(p.id);
        const label = isExploratory ? " (exploring)" : "";
        lines.push(`**[${p.id}]**${label} (score: ${score.toFixed(2)})`);
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
