# Principle Retrieval Improvements

## Problem

Current retrieval has a chicken-and-egg issue:

- Principles must be "high-scoring" to be loaded at session start
- But principles need to be used to get scored
- New/untested principles never get surfaced

Also, retrieval is context-blind—it doesn't consider:

- What the user is working on (git history, recent files)
- Semantic relevance to the current task
- Recent session patterns

## Proposed Solutions

### 1. Mid-Session Retrieval Tool (MCP Server)

Give Claude an on-demand tool to query principles when it needs guidance.

```typescript
// src/mcp/server.ts
import {
  McpServer,
  ResourceTemplate,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ExpBaseStorage } from "../storage/expbase.js";

const server = new McpServer({
  name: "evolver",
  version: "1.0.0",
});
const DB_PATH =
  process.env.EVOLVER_DB_PATH ??
  new URL(".evolver/expbase.db", import.meta.url).pathname;

// Tool: Search principles by query, tags, or semantic similarity
server.tool(
  "search_principles",
  "Search for relevant principles based on your current task or problem",
  {
    query: {
      type: "string",
      description: "Natural language description of situation",
    },
    tags: {
      type: "array",
      items: { type: "string" },
      description: "Filter by tags",
    },
    include_exploration: {
      type: "boolean",
      description: "Include some untested principles",
    },
    limit: { type: "number", default: 5 },
  },
  async ({ query, tags, include_exploration, limit = 5 }) => {
    const storage = new ExpBaseStorage({ dbPath: DB_PATH });

    // Core retrieval by tags/score
    let principles = storage.searchPrinciples({
      tags,
      limit: limit * 2,
      min_principle_score: 0.3, // Lower threshold for on-demand
    });

    // Exploration: add 1-2 untested/new principles
    if (include_exploration) {
      const exploratory = storage.getExploratoryPrinciples(2);
      principles = [...principles, ...exploratory];
    }

    storage.close();

    const principlesWithMeta = principles.map((p) => ({
      id: p.id,
      title: p.title,
      tags: p.tags,
      score: p.score ?? 0,
      last_used_at: p.last_used_at,
      success_rate:
        p.use_count && p.use_count > 0 ? p.success_count / p.use_count : null,
      use_count: p.use_count,
    }));

    return {
      content: [
        {
          type: "text",
          text: formatPrinciples(principlesWithMeta),
        },
        {
          type: "json",
          json: principlesWithMeta,
        },
      ],
    };
  }
);

// Tool: Mark principle as useful/not useful (immediate feedback)
server.tool(
  "rate_principle",
  "Provide feedback on whether a principle was helpful",
  {
    principle_id: { type: "string", required: true },
    was_helpful: { type: "boolean", required: true },
    context: { type: "string", description: "Brief note on why" },
  },
  async ({ principle_id, was_helpful, context }) => {
    const storage = new ExpBaseStorage({ dbPath: DB_PATH });
    storage.recordUsage(principle_id, undefined, was_helpful);
    storage.close();
    return { content: [{ type: "text", text: "Feedback recorded" }] };
  }
);

// Resource: View all principles with scores
server.resource("principles://all", "All principles with scores", async () => ({
  /* ... */
}));

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
main();
```

**Configuration** (add to `.claude/settings.json`):

```json
{
  "mcpServers": {
    "evolver": {
      "command": "bun",
      "args": ["run", "src/mcp/server.ts"],
      "env": {
        "EVOLVER_DB_PATH": "${EVOLVER_DB_PATH}"
      }
    }
  }
}
```

### 2. Contextual Startup Retrieval

Enhance `session-start.ts` to analyze context before retrieving:

```typescript
// hooks/session-start.ts (enhanced)

interface RetrievalContext {
  recentCommits: string[]; // Last 5 commit messages
  changedFiles: string[]; // Files modified recently
  projectTags: string[]; // Inferred from package.json, CLAUDE.md
  recentSessionTags: string[]; // Tags from last 3 sessions
}

async function gatherContext(cwd: string): Promise<RetrievalContext> {
  const context: RetrievalContext = {
    recentCommits: [],
    changedFiles: [],
    projectTags: [],
    recentSessionTags: [],
  };

  // 1. Git history analysis
  try {
    const gitLog = await $`git -C ${cwd} log --oneline -5 --format="%s"`.text();
    context.recentCommits = gitLog.trim().split("\n").filter(Boolean);

    const gitDiff = await $`git -C ${cwd} diff --name-only HEAD~5 HEAD`.text();
    context.changedFiles = gitDiff.trim().split("\n").filter(Boolean);
  } catch {
    /* not a git repo */
  }

  // 2. Project type inference
  const pkgJson = Bun.file(join(cwd, "package.json"));
  if (await pkgJson.exists()) {
    const pkg = await pkgJson.json();
    // Extract keywords from deps, scripts, name
    const deps = Object.keys(pkg.dependencies || {});
    if (deps.includes("react")) context.projectTags.push("react", "frontend");
    if (deps.includes("express"))
      context.projectTags.push("express", "backend");
    // ... more inference
  }

  // 3. Recent session analysis
  const storage = new ExpBaseStorage({ dbPath: DB_PATH });
  const recentTraces = storage.searchTraces({
    limit: 20,
    time_range: {
      start: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
      end: new Date().toISOString(),
    },
  });

  // Extract common tags from recent successful traces
  const tagCounts = new Map<string, number>();
  for (const trace of recentTraces.filter(
    (t) => t.outcome.status === "success"
  )) {
    for (const tag of trace.tags || []) {
      tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
    }
  }
  context.recentSessionTags = [...tagCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([tag]) => tag);

  storage.close();
  return context;
}

async function retrievePrinciples(
  context: RetrievalContext
): Promise<Principle[]> {
  const storage = new ExpBaseStorage({ dbPath: DB_PATH });

  // Combine all context into search tags
  const searchTags = [
    ...context.projectTags,
    ...context.recentSessionTags,
    ...extractKeywords(context.recentCommits.join(" ")),
  ];

  // Score-based retrieval with context weighting
  const allPrinciples = storage.getPrincipleScores();

  const scored = allPrinciples.map(({ principle, score }) => {
    let contextBoost = 0;

    // Boost principles matching project context
    for (const tag of principle.tags) {
      if (searchTags.includes(tag)) contextBoost += 0.1;
    }

    return {
      principle,
      finalScore: score + contextBoost,
    };
  });

  storage.close();

  return scored
    .sort((a, b) => b.finalScore - a.finalScore)
    .slice(0, MAX_PRINCIPLES)
    .map((s) => s.principle);
}
```

### 3. Exploration Mechanism

Add exploration to ensure new principles get tested:

```typescript
// src/storage/expbase.ts (add method)

/**
 * Get principles for exploration (untested or under-tested)
 * Uses Thompson Sampling-inspired selection
 */
getExploratoryPrinciples(count: number): Principle[] {
  const allPrinciples = this.getAllPrinciples();

  // Candidates: principles with < 5 uses OR created in last 7 days
  const candidates = allPrinciples.filter(p =>
    p.use_count < 5 ||
    (Date.now() - new Date(p.created_at).getTime()) < 7 * 24 * 60 * 60 * 1000
  );

  if (candidates.length === 0) return [];

  // Thompson Sampling: sample from Beta(success+1, failure+1)
  const scored = candidates.map(p => ({
    principle: p,
    sample: betaSample(p.success_count + 1, (p.use_count - p.success_count) + 1),
  }));

  // Return top N by sampled score
  return scored
    .sort((a, b) => b.sample - a.sample)
    .slice(0, count)
    .map(s => s.principle);
}

// Simple Beta distribution sampler
function betaSample(alpha: number, beta: number): number {
  // Use Gamma sampling: Beta(a,b) = Gamma(a,1) / (Gamma(a,1) + Gamma(b,1))
  const gammaSample = (shape: number): number => {
    // Marsaglia and Tsang's method (simplified)
    if (shape < 1) {
      return gammaSample(shape + 1) * Math.pow(Math.random(), 1 / shape);
    }
    const d = shape - 1/3;
    const c = 1 / Math.sqrt(9 * d);
    while (true) {
      let x: number, v: number;
      do {
        x = normalSample();
        v = 1 + c * x;
      } while (v <= 0);
      v = v * v * v;
      const u = Math.random();
      if (u < 1 - 0.0331 * (x * x) * (x * x)) return d * v;
      if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
    }
  };

  const normalSample = (): number => {
    const u1 = Math.random();
    const u2 = Math.random();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  };

  const x = gammaSample(alpha);
  const y = gammaSample(beta);
  return x / (x + y);
}
```

**Integration in session-start.ts**:

```typescript
// After main retrieval, add exploration slots
const mainPrinciples = await retrievePrinciples(context);
const exploratoryPrinciples = storage.getExploratoryPrinciples(2);

// Dedupe and combine
const allPrinciples = [
  ...mainPrinciples,
  ...exploratoryPrinciples.filter(
    (e) => !mainPrinciples.some((m) => m.id === e.id)
  ),
].slice(0, MAX_PRINCIPLES);

// Mark exploratory ones in output
for (const p of allPrinciples) {
  const isExploratory = exploratoryPrinciples.some((e) => e.id === p.id);
  lines.push(`**[${p.id}]** ${isExploratory ? "(exploring)" : ""}`);
}
```

## Implementation Order

1. **Exploration mechanism** (quick win, solves cold-start)

   - Add `getExploratoryPrinciples()` to expbase.ts
   - Update session-start.ts to include 1-2 exploratory principles

2. **Contextual startup** (medium effort, high value)

   - Add git/project analysis to session-start.ts
   - Boost principles matching current context

3. **MCP tool** (higher effort, enables on-demand retrieval)
   - Create MCP server with search_principles and rate_principle
   - Add to settings.json

## Questions to Consider

- Should exploration happen every session or probabilistically?
- How much weight should context matching get vs raw score?
- Should the MCP tool also allow adding new principles on the fly?
