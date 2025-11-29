# EvolveR Harness

An experience-augmented wrapper for Claude Code that implements key ideas from the [EvolveR paper](https://arxiv.org/abs/2510.16079), enabling continuous self-improvement through principle extraction and retrieval.

## Core Concept

The model is fixed. Your wrapper learns a growing library of strategy snippets and learns which ones to show when.

This harness wraps Claude Code with:

1. **Experience Base (ExpBase)** - A SQLite store of natural language "strategic principles" with usage tracking
2. **Trace Logging** - Captures problem-solving trajectories for later analysis
3. **Offline Distillation** - Extracts reusable principles from traces using Claude
4. **Online Retrieval** - Injects relevant principles into context before each session
5. **Bayesian Scoring** - Tracks which principles work with formula `s(p) = (success_count + 1) / (use_count + 2)`

## Architecture

```
┌────────────────────────────────────────────────────────────────┐
│                         Claude Code                            │
├────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │ Session Hook │→ │ Trace Logger │→ │ ExpBase (SQLite)     │  │
│  │ (start/end)  │  │              │  │ - Principles         │  │
│  └──────────────┘  └──────────────┘  │ - Traces             │  │
│         ↓                            │ - Usage Stats        │  │
│  ┌──────────────┐                    └──────────────────────┘  │
│  │ Tool Collect │                              ↑               │
│  │ Hook         │                              │               │
│  └──────────────┘                    ┌─────────┴────────────┐  │
│                                      │ Distiller (offline)  │  │
│  ┌──────────────┐  ┌──────────────┐  │ - Analyze traces     │  │
│  │ Orchestrator │← │ Retriever    │← │ - Extract principles │  │
│  │ (pre/post)   │  │              │  │ - Dedupe & merge     │  │
│  └──────────────┘  └──────────────┘  └──────────────────────┘  │
└────────────────────────────────────────────────────────────────┘
```

## Quick Start

### Option 1: Hooks-Based (Recommended)

No wrapper script needed - just run `claude` normally from this directory:

```bash
# 1. Install dependencies
bun install

# 2. Initialize the database
./bin/evolver-init

# 3. Run Claude Code from this directory
claude

# Hooks automatically:
# - Inject top-scoring principles at session start
# - Add task-specific principles per prompt
# - Log all tool calls for traces
# - Save traces at session end
```

The hooks are configured in `.claude/settings.json` and run automatically when you run Claude Code from this project directory.

### Option 2: Wrapper Script (Legacy)

```bash
# Wrap a Claude Code session with experience
./bin/evolver --task="Fix the authentication bug"
```

### After Sessions

```bash
# Run distillation to extract principles from traces
bun run distill 10   # or: npx tsx src/distiller/cli.ts distill 10

# Check your experience base
bun run distill:stats   # or: npx tsx src/distiller/cli.ts stats
```

> **Note**: The distiller and related CLIs require `tsx` (node-based) because `better-sqlite3` is not yet supported in Bun. Use the npm scripts or `npx tsx` to run TypeScript files.

## Components

### Storage Layer (`src/storage/expbase.ts`)

SQLite-backed storage with:
- Principles table with embeddings, tags, triples
- Traces table with full trajectory data
- Usage tracking with foreign keys
- Intelligent indexing for fast queries

```typescript
import { ExpBaseStorage } from './src/storage/expbase.js';

const storage = new ExpBaseStorage({ dbPath: '~/.evolver/expbase.db' });

// Add a principle
const principle = storage.addPrinciple({
  text: "When debugging a failing test, reproduce locally before editing production code.",
  tags: ["debugging", "tests"],
  triples: [{ subject: "task_type", relation: "equals", object: "debugging" }],
  examples: [],
});

// Search principles
const results = storage.searchPrinciples({
  tags: ["debugging"],
  min_principle_score: 0.6,
});
```

### Trace Logger (`src/logger/`)

Captures agent trajectories during sessions:

```typescript
import { TraceLogger } from './src/logger/trace-logger.js';

const logger = new TraceLogger('~/.evolver/expbase.db');

// Start session
logger.startSession("Fix login bug", "Users can't login with OAuth");

// Log tool calls
logger.logToolCall("Read", { file: "auth.ts" }, "file contents...");

// Log reasoning
logger.logThought("The OAuth callback URL is misconfigured");

// End session with outcome
const trace = logger.endSession("Fixed OAuth callback", {
  status: "success",
  score: 1.0,
});
```

### Distiller (`src/distiller/`)

Extracts principles from traces using Claude:

```bash
# Distill recent traces
bun src/distiller/cli.ts distill 10

# Distill specific trace
bun src/distiller/cli.ts distill-trace <trace-id>

# Run deduplication pass
bun src/distiller/cli.ts dedupe

# Prune low-scoring principles
bun src/distiller/cli.ts prune --threshold=0.3

# View statistics
bun src/distiller/cli.ts stats
```

### Orchestrator (`src/orchestrator/`)

Coordinates the full session lifecycle:

```typescript
import { EvolverOrchestrator } from './src/orchestrator/orchestrator.js';

const orchestrator = new EvolverOrchestrator({
  dbPath: '~/.evolver/expbase.db',
  enableEmbeddings: true,
  contextFilePath: '~/.evolver/context.md',
});

// Wrap a session (retrieves principles, injects context)
const context = await orchestrator.wrapSession("Fix the login bug");

// After session, update principle scores
await orchestrator.postSession({
  status: "success",
  score: 1.0,
});
```

### CLI Wrapper (`bin/evolver`)

Shell wrapper for easy usage:

```bash
# Wrap a session
evolver --task="Add dark mode support"

# Check status
evolver status

# Sync principles to CLAUDE.md
evolver sync --output=./CLAUDE.md --max=20 --min-score=0.6

# Search experience
evolver search --query="performance optimization"
```

## Principle Format

Principles are stored as structured knowledge:

```json
{
  "id": "principle-abc123",
  "text": "When fixing a bug, first reproduce it with a minimal test to confirm the failure.",
  "triples": [
    { "subject": "task_type", "relation": "equals", "object": "bug_fix" },
    { "subject": "practice", "relation": "includes", "object": "write_failing_test_first" }
  ],
  "tags": ["debugging", "tests", "tdd"],
  "examples": [
    { "trace_id": "trace-xyz", "relevance_note": "Fixed auth bug using this approach" }
  ],
  "use_count": 15,
  "success_count": 12,
  "embedding": [0.1, 0.2, ...],
  "confidence": 0.85
}
```

## Reasoning Contract

The system injects a reasoning contract into Claude Code's context:

```markdown
# Experience-Based Reasoning Contract

You have access to an experience base containing learned principles.

## When to Search Experience

- Starting a new task (to find relevant strategies)
- Encountering uncertainty (to learn from similar situations)
- After a failure (to find alternative approaches)
- Before making significant decisions (to validate reasoning)

## Reasoning with Principles

When a principle is retrieved:
- Evaluate relevance: Does it apply to the current situation?
- Assess confidence: Score = (success_count + 1) / (use_count + 2)
- Adapt strategically: How should it be modified for this context?
- Track usage: Note which principles influenced your decisions
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `EVOLVER_DB_PATH` | `~/.evolver/expbase.db` | Path to SQLite database |
| `EVOLVER_CONTEXT_FILE` | `~/.evolver/context.md` | Context injection file (wrapper only) |
| `EVOLVER_STATE_FILE` | `~/.evolver/session-state.json` | Session state for hooks |
| `EVOLVER_MAX_PRINCIPLES` | `10` | Max principles to inject at session start |
| `EVOLVER_MIN_SCORE` | `0.5` | Min Bayesian score for principle injection |
| `EVOLVER_ENABLE_EMBEDDINGS` | `false` | Enable semantic search |
| `EVOLVER_VERBOSE` | `false` | Enable verbose logging |
| `ANTHROPIC_API_KEY` | - | Required for distillation |
| `OPENAI_API_KEY` | - | Required for embeddings |

## Hooks Integration

The harness uses Claude Code hooks for seamless integration (configured in `.claude/settings.json`):

| Hook | Purpose |
|------|---------|
| **SessionStart** | Retrieves top principles and injects them as context |
| **UserPromptSubmit** | Adds task-specific principles based on prompt keywords |
| **PostToolUse** | Logs tool calls to session state for trace collection |
| **SessionEnd** | Saves the complete trace to ExpBase |

Key benefits over the wrapper script:
- No special command needed - just run `claude`
- Context injected dynamically (no CLAUDE.md modification)
- Per-prompt principle retrieval based on task keywords
- Environment variables persisted via `CLAUDE_ENV_FILE`

## Workflow

### Daily Usage

1. Run `claude` from the project directory
2. Hooks inject relevant principles automatically
3. Work on your tasks as usual
4. Session ends, trace is saved to ExpBase

### Periodic Maintenance

1. Run distillation: `bun src/distiller/cli.ts distill`
2. Run deduplication: `bun src/distiller/cli.ts dedupe`
3. Prune low performers: `bun src/distiller/cli.ts prune --threshold=0.3`
4. Sync to CLAUDE.md: `evolver sync`

## Key Insights from EvolveR

This implementation captures these key ideas without RL training:

1. **Experience as Strategic Principles** - Not raw traces, but distilled "When X, do Y" guidance
2. **Bayesian Scoring** - Conservative estimates with `(success + 1) / (use + 2)`
3. **Semantic Deduplication** - Merge similar principles via embeddings
4. **Online Retrieval** - Context-aware principle injection
5. **Continuous Improvement** - Usage tracking creates a feedback loop

## Development

```bash
# Install dependencies
bun install

# Type check
bun run typecheck

# Lint and format
bun run lint
bun run format
```

## License

ISC

