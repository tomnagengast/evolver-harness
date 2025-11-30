# Getting Started with EvolveR Harness

This guide walks you through setting up EvolveR Harness in your project to enable continuous self-improvement for Claude Code.

## Prerequisites

- [Bun](https://bun.sh) runtime installed
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI installed
- API keys for distillation (optional but recommended):
  - `ANTHROPIC_API_KEY` - For principle extraction
  - `OPENAI_API_KEY` - For principle embeddings

## Installation

### Option 1: Clone into your project

```bash
# Clone the harness into your project
git clone https://github.com/tomnagengast/evolver-harness.git .evolver-harness

# Install dependencies
cd .evolver-harness && bun install && cd ..
```

### Option 2: Add as a git submodule

```bash
git submodule add https://github.com/tomnagengast/evolver-harness.git .evolver-harness
cd .evolver-harness && bun install && cd ..
```

## Configuration

### 1. Set up environment variables

```bash
cd .evolver-harness
cp .env.example .env
```

Edit `.env` with your settings:

```bash
# Required for distillation
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...

# Optional: customize paths (defaults work for most setups)
EVOLVER_DB_PATH=.evolver/expbase.db
EVOLVER_STATE_DIR=.evolver/sessions

# Optional: tune behavior
EVOLVER_MAX_PRINCIPLES=10      # Principles injected at session start
EVOLVER_MIN_SCORE=0.5          # Minimum score threshold
EVOLVER_AUTO_DISTILL=true      # Enable automatic distillation
EVOLVER_AUTO_DISTILL_THRESHOLD=5  # Traces before auto-distill
```

### 2. Configure Claude Code hooks

Create or update `.claude/settings.json` in your project root:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "bun --cwd $CLAUDE_PROJECT_DIR/.evolver-harness hooks/session-start.ts",
            "timeout": 10
          }
        ]
      }
    ],
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "bun --cwd $CLAUDE_PROJECT_DIR/.evolver-harness hooks/prompt-submit.ts",
            "timeout": 5
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "bun --cwd $CLAUDE_PROJECT_DIR/.evolver-harness hooks/post-tool-use.ts",
            "timeout": 5
          }
        ]
      }
    ],
    "SessionEnd": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "bun --cwd $CLAUDE_PROJECT_DIR/.evolver-harness hooks/session-end.ts",
            "timeout": 10
          }
        ]
      }
    ]
  }
}
```

### 3. Enable MCP server (optional)

Create or update `.mcp.json` in your project root:

```json
{
  "mcpServers": {
    "evolver": {
      "command": "bun",
      "args": ["run", ".evolver-harness/src/mcp/server.ts"]
    }
  }
}
```

This enables runtime principle search and feedback tools.

## Usage

### Daily workflow

1. **Start Claude Code** from your project directory:

   ```bash
   claude
   ```

2. **Work normally** - The harness automatically:

   - Injects relevant principles at session start
   - Adds task-specific principles per prompt
   - Logs all tool calls
   - Saves traces when you're done

3. **Principles improve over time** as the system learns from your sessions

### Manual distillation

Run distillation to extract principles from accumulated traces:

```bash
cd .evolver-harness

# Process recent traces
bun run distill 10

# View statistics
bun run distill:stats

# Deduplicate similar principles
bun run distill:dedupe

# Remove low-scoring principles
bun run distill:prune --threshold=0.3
```

### Using MCP tools (if enabled)

During a Claude Code session, you can:

- **Search principles**: Ask Claude to search for relevant principles
- **Rate principles**: Provide feedback on whether a principle was helpful
- **List tags**: Discover available principle categories

## Verification

Check that everything is working:

```bash
# 1. Verify hooks are configured
cat .claude/settings.json | grep evolver

# 2. Start a Claude Code session
claude

# 3. After the session, check for traces
cd .evolver-harness
bun run distill:stats
```

You should see trace counts increasing after each session.

## Troubleshooting

### Hooks not running

- Ensure Bun is installed and in your PATH
- Check that `.claude/settings.json` paths are correct
- Enable verbose logging: `EVOLVER_VERBOSE=true`

### No principles showing

- The experience base starts empty
- Run a few sessions, then distill: `bun run distill 10`
- Check stats: `bun run distill:stats`

### Distillation failing

- Verify `ANTHROPIC_API_KEY` is set
- Check API key has sufficient credits
- Run with verbose: `EVOLVER_VERBOSE=true bun run distill 5`

## Next Steps

- Read the [README](../README.md) for architecture details
- Explore the [EvolveR paper](https://arxiv.org/abs/2510.16079) for background
- Check `bun run distill:stats` regularly to monitor your experience base
