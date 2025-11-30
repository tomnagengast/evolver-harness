# EvolveR Harness

An experience-augmented extension for Claude Code that implements key ideas from the [EvolveR paper](https://arxiv.org/abs/2510.16079), enabling continuous self-improvement through principle extraction and retrieval.

## Core Concept

The model is fixed. The harness learns a growing library of strategy snippets and learns which ones to show when.

This harness extends Claude Code with:

1. **Experience Base (ExpBase)** - A SQLite store of natural language "strategic principles" with usage tracking
2. **Hooks** - Native Claude Code hooks that inject principles and collect traces
3. **Offline Distillation** - Extracts reusable principles from traces using Claude
4. **Bayesian Scoring** - Tracks which principles work with formula `s(p) = (success_count + 1) / (use_count + 2)`
5. **Intelligent Success Criteria** - Multi-dimensional outcome scoring with user feedback and fine-grained credit assignment

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
| UserPromptSubmit | `prompt-submit.ts` | Task-aware retrieval + user feedback capture |
| PostToolUse | `post-tool-use.ts` | Logs tool calls with success detection + principle context |
| Stop | `session-end.ts` | Saves trace with multi-dimensional scoring |
| SessionEnd | `session-end.ts` | Saves trace + assigns weighted credit to principles |

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
| `EVOLVER_STATE_DIR` | `~/.evolver/sessions` | Directory for session state files |
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

## Intelligent Success Criteria

The harness uses multi-dimensional outcome scoring inspired by recent research on credit assignment in LLM agents. Instead of binary success/failure, principles receive **weighted credit** (0-1) based on multiple signals.

### Outcome Signals

| Signal | Weight | Description |
|--------|--------|-------------|
| Tool Success Rate | 25% | Percentage of tool calls without errors |
| User Sentiment | 35% | Implicit/explicit feedback from user prompts |
| Made Edits | 20% | Whether code changes were made |
| No Errors | 20% | Absence of errors in tool outputs |

### User Feedback Detection

The `prompt-submit` hook analyzes each user prompt for feedback signals:

| Type | Examples | Sentiment |
|------|----------|-----------|
| Explicit Positive | "thanks", "perfect", "works" | 1.0 |
| Explicit Negative | "wrong", "undo", "try again" | 0.0 |
| Implicit Retry | Similar prompt to previous | 0.2 |
| Implicit Continuation | New unrelated task | 0.7 |

### Fine-Grained Credit Assignment

Each principle receives individual credit based on:

1. **Tool Success Context** - Which tools succeeded while the principle was active
2. **Temporal Attribution** - Principles injected closer to successful tool calls get more credit
3. **User Feedback** - Sentiment from subsequent user prompts

```typescript
// Credit formula for each principle
credit = (base_outcome * 0.6 + tool_success_rate * 0.4) * 0.7 + user_sentiment * 0.3
```

This enables:
- Principles that helped succeed get boosted
- Principles active during failures get penalized
- User satisfaction directly influences learning

## Key Insights from EvolveR

This implementation captures these key ideas without RL training:

1. **Experience as Strategic Principles** - Not raw traces, but distilled "When X, do Y" guidance
2. **Bayesian Scoring** - Conservative estimates with `(success + 1) / (use + 2)`
3. **Semantic Deduplication** - Merge similar principles via embeddings
4. **Online Retrieval** - Context-aware principle injection via hooks
5. **Continuous Improvement** - Usage tracking creates a feedback loop
6. **Multi-Dimensional Success** - Rich outcome signals beyond binary success/failure

## MCP Server

The harness exposes an MCP server (`evolver`) for runtime principle access. It's automatically registered in `.mcp.json`.

### Available Tools

| Tool | Description |
|------|-------------|
| `search_principles` | Search principles by query/tags with optional exploration |
| `rate_principle` | Provide feedback on principle helpfulness |
| `list_tags` | Discover available principle categories |
| `list_loaded_principles` | View principles injected at session start |

### Usage Examples

```typescript
// Search for relevant principles
search_principles({
  query: "debugging failing tests",
  tags: ["debugging"],
  include_exploration: true,
  limit: 5
})

// Rate a principle after use
rate_principle({
  principle_id: "abc123",
  was_helpful: true,
  context: "Helped identify root cause quickly"
})
```

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

## Project Structure

```
evolver-harness/
├── hooks/                 # Claude Code lifecycle hooks
│   ├── session-start.ts   # Inject top principles + contextual retrieval
│   ├── prompt-submit.ts   # Task-aware principle retrieval per prompt
│   ├── post-tool-use.ts   # Log tool calls to session state
│   └── session-end.ts     # Save trace + trigger distillation
├── src/
│   ├── storage/expbase.ts # SQLite storage layer
│   ├── distiller/         # Offline principle extraction
│   │   ├── distiller.ts   # Core distillation logic
│   │   ├── cli.ts         # CLI interface
│   │   ├── embeddings.ts  # OpenAI embedding support
│   │   └── prompts.ts     # Distillation prompts
│   ├── mcp/server.ts      # MCP server for principle tools
│   ├── index.ts           # Public exports
│   └── types.ts           # Core TypeScript interfaces
├── .claude/settings.json  # Hook configuration
└── .mcp.json              # MCP server registration
```

## References

This implementation draws inspiration from several research papers:

| Paper | Key Contribution | Link |
|-------|------------------|------|
| **EvolveR** | Experience-augmented LLM agents with principle extraction and Bayesian scoring | [arXiv:2510.16079](https://arxiv.org/abs/2510.16079) |
| **ExpeL** | Experiential learning with insight extraction from success/failure trajectories | [arXiv:2308.10144](https://arxiv.org/abs/2308.10144) |
| **MT-GRPO** | Turn-level credit assignment separating action rewards from outcome rewards | [arXiv:2505.11821](https://arxiv.org/abs/2505.11821) |
| **LaRe** | Latent reward models for multi-dimensional credit assignment | [arXiv:2412.11120](https://arxiv.org/abs/2412.11120) |
| **RAGEN** | Multi-turn agent self-improvement with trajectory-level rewards | [arXiv:2504.20073](https://arxiv.org/abs/2504.20073) |

## License

ISC

