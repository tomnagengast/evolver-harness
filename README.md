# EvolveR Harness

An experience-augmented extension for Claude Code that implements key ideas from the [EvolveR paper](https://arxiv.org/abs/2510.16079), enabling continuous self-improvement through principle extraction and retrieval.

## Core Concept

The model is fixed. The harness learns a growing library of strategy snippets and learns which ones to show when.

This harness extends Claude Code with:

1. **Experience Base (ExpBase)** - A SQLite store of natural language "strategic principles" with usage tracking
2. **Hooks** - Native Claude Code hooks that inject principles and collect traces
3. **Offline Distillation** - Extracts reusable principles from traces using Claude
4. **Bayesian Scoring** - Tracks which principles work with formula `s(p) = (success_count + 1) / (use_count + 2)`

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                       Claude Code                           │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────────┐                                        │
│  │ SessionStart    │──→ Retrieve & inject top principles    │
│  │ Hook            │                                        │
│  └─────────────────┘                                        │
│  ┌─────────────────┐                                        │
│  │ PromptSubmit    │──→ Task-aware principle retrieval      │
│  │ Hook            │                                        │
│  └─────────────────┘        ┌──────────────────────────┐    │
│  ┌─────────────────┐        │ ExpBase (SQLite)         │    │
│  │ PostToolUse     │──→     │ - Principles             │    │
│  │ Hook            │        │ - Traces                 │    │
│  └─────────────────┘        │ - Usage Stats            │    │
│  ┌─────────────────┐        └──────────────────────────┘    │
│  │ SessionEnd      │──→ Save trace            ↑             │
│  │ Hook            │                          │             │
│  └─────────────────┘              ┌───────────┴──────────┐  │
│                                   │ Distiller (offline)  │  │
│                                   │ - Analyze traces     │  │
│                                   │ - Extract principles │  │
│                                   │ - Dedupe & merge     │  │
│                                   └──────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

## Quick Start

```bash
# 1. Install dependencies
bun install

# 2. Copy environment config
cp .env.example .env

# 3. Run Claude Code from this directory
claude

# Hooks automatically:
# - Inject top-scoring principles at session start
# - Add task-specific principles per prompt
# - Log all tool calls for traces
# - Save traces after each response (Stop) and at session end
```

The hooks are configured in `.claude/settings.json` and run automatically.

### After Sessions

```bash
# Run distillation to extract principles from traces
bun run distill 10

# Check your experience base
bun run distill:stats
```

## Components

### Hooks (`hooks/`)

Native Claude Code hooks that handle the full session lifecycle:

| Hook | File | Purpose |
|------|------|---------|
| SessionStart | `session-start.ts` | Retrieves top principles, outputs as context |
| UserPromptSubmit | `prompt-submit.ts` | Task-aware retrieval from prompt keywords |
| PostToolUse | `post-tool-use.ts` | Logs tool calls to session state |
| Stop | `session-end.ts` | Saves trace after each response |
| SessionEnd | `session-end.ts` | Saves trace when session terminates |

### Storage Layer (`src/storage/expbase.ts`)

SQLite-backed storage with:
- Principles table with embeddings, tags, triples
- Traces table with full trajectory data
- Usage tracking with Bayesian scoring

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

### Distiller (`src/distiller/`)

Extracts principles from traces using Claude:

```bash
# Distill recent traces
bun run distill 10

# Distill specific trace
bun run distill:trace <trace-id>

# Run deduplication pass
bun run distill:dedupe

# Prune low-scoring principles
bun run distill:prune --threshold=0.3

# View statistics
bun run distill:stats
```

## Principle Format

Principles are stored as structured knowledge:

```json
{
  "id": "principle-abc123",
  "text": "When fixing a bug, first reproduce it with a minimal test.",
  "triples": [
    { "subject": "task_type", "relation": "equals", "object": "bug_fix" }
  ],
  "tags": ["debugging", "tests"],
  "use_count": 15,
  "success_count": 12
}
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `EVOLVER_DB_PATH` | `~/.evolver/expbase.db` | Path to SQLite database |
| `EVOLVER_STATE_FILE` | `~/.evolver/session-state.json` | Session state for hooks |
| `EVOLVER_MAX_PRINCIPLES` | `10` | Max principles to inject at session start |
| `EVOLVER_MIN_SCORE` | `0.5` | Min Bayesian score for principle injection |
| `EVOLVER_PROMPT_MAX_PRINCIPLES` | `5` | Max principles per prompt (UserPromptSubmit) |
| `EVOLVER_PROMPT_MIN_SCORE` | `0.5` | Min score for prompt retrieval |
| `EVOLVER_VERBOSE` | `false` | Enable verbose logging |
| `EVOLVER_AUTO_DISTILL` | `true` | Enable automatic background distillation |
| `EVOLVER_AUTO_DISTILL_THRESHOLD` | `5` | Undistilled trace count to trigger distillation |
| `ANTHROPIC_API_KEY` | - | Required for distillation |
| `OPENAI_API_KEY` | - | Required for embeddings |

## Workflow

### Daily Usage

1. Run `claude` from the project directory
2. Hooks inject relevant principles automatically
3. Work on your tasks as usual
4. Session ends, trace is saved to ExpBase
5. After 5 traces accumulate, background distillation extracts new principles

### Manual Maintenance (optional)

1. Run distillation: `bun run distill 10`
2. Run deduplication: `bun run distill:dedupe`
3. Prune low performers: `bun run distill:prune --threshold=0.3`

## Key Insights from EvolveR

This implementation captures these key ideas without RL training:

1. **Experience as Strategic Principles** - Not raw traces, but distilled "When X, do Y" guidance
2. **Bayesian Scoring** - Conservative estimates with `(success + 1) / (use + 2)`
3. **Semantic Deduplication** - Merge similar principles via embeddings
4. **Online Retrieval** - Context-aware principle injection via hooks
5. **Continuous Improvement** - Usage tracking creates a feedback loop

## Development

```bash
# Install dependencies
bun install

# Run tests
bun test

# Type check
bun run typecheck

# Lint and format
bun run lint
bun run format
```

## License

ISC

