# Trace Logger for Evolver Harness

A comprehensive trace logging system that integrates with Claude Code hooks to automatically capture agent interactions, tool calls, and reasoning steps.

## Overview

The trace logger consists of:

1. **TraceLogger** - Core TypeScript class for accumulating traces
2. **CLI** - Command-line interface for hook integration
3. **Hooks** - Scripts that integrate with Claude Code lifecycle events

## Architecture

```
┌─────────────────┐
│  Claude Code    │
│    Session      │
└────────┬────────┘
         │
         │ Hooks
         ▼
┌─────────────────┐
│   Session       │
│   State File    │
│   (temp JSON)   │
└────────┬────────┘
         │
         │ CLI Commands
         ▼
┌─────────────────┐
│  TraceLogger    │
└────────┬────────┘
         │
         │ addTrace()
         ▼
┌─────────────────┐
│   ExpBase       │
│   (SQLite)      │
└─────────────────┘
```

## Files

### Core Logger
- `/src/logger/trace-logger.ts` - TraceLogger and SessionStateManager classes
- `/src/logger/cli.ts` - CLI interface for hook invocations

### Hooks
- `/hooks/session-start.js` - Initializes trace session on Claude Code start
- `/hooks/collect.js` - Logs each tool call
- `/hooks/session-end.js` - Finalizes and saves trace on session end

### Configuration
- `/.claude/hooks.json.example` - Example Claude Code hooks configuration

## Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment Variables

Set these in your shell or `.claude/hooks.json`:

```bash
export EVOLVER_DB_PATH="$HOME/.evolver/expbase.db"
export EVOLVER_STATE_FILE="/tmp/evolver-harness-session.json"
```

### 3. Configure Claude Code Hooks

Copy the example configuration:

```bash
cp .claude/hooks.json.example .claude/hooks.json
```

Edit `.claude/hooks.json` to customize paths if needed.

### 4. Initialize the Database

The database will be created automatically on first use, but you can pre-create it:

```typescript
import { ExpBaseStorage } from './src/storage/expbase.js';

const storage = new ExpBaseStorage({
  dbPath: process.env.EVOLVER_DB_PATH || `${process.env.HOME}/.evolver/expbase.db`
});

storage.close();
```

## Usage

### Automatic Mode (via Hooks)

Once configured, traces are automatically logged during Claude Code sessions:

1. **Session Start**: When you start a Claude Code session, `session-start.js` creates a new trace session
2. **Tool Calls**: Each tool invocation triggers `collect.js` to log the call
3. **Session End**: When the session ends, `session-end.js` saves the complete trace to ExpBase

### Manual Mode (via CLI)

You can also use the CLI directly:

```bash
# Start a session
node src/logger/cli.ts start \
  --task="Fix authentication bug" \
  --problem="Users cannot log in with OAuth" \
  --model="claude-sonnet-4-5-20250929"

# Log a tool call
node src/logger/cli.ts log-tool \
  --tool=Read \
  --input='{"file_path":"/path/to/auth.ts"}' \
  --output='export function authenticate() { ... }'

# Log a thought
node src/logger/cli.ts log-thought \
  --thought="The issue appears to be in the token validation logic"

# Check status
node src/logger/cli.ts status

# End session
node src/logger/cli.ts end \
  --answer="Fixed OAuth token validation in auth.ts" \
  --outcome=success \
  --score=1.0 \
  --tags="authentication,bug-fix"
```

### Programmatic Mode (via API)

```typescript
import { TraceLogger } from './src/logger/trace-logger.js';

const logger = new TraceLogger('~/.evolver/expbase.db');

// Start session
const session = logger.startSession(
  'Fix authentication bug',
  'Users cannot log in with OAuth',
  { modelUsed: 'claude-sonnet-4-5-20250929' }
);

// Log tool calls
logger.logToolCall('Read',
  { file_path: '/path/to/auth.ts' },
  'export function authenticate() { ... }'
);

// Log thoughts
logger.logThought('The issue appears to be in the token validation logic');

// End session
const trace = logger.endSession(
  'Fixed OAuth token validation in auth.ts',
  { status: 'success', score: 1.0 },
  { tags: ['authentication', 'bug-fix'] }
);

logger.close();
```

## CLI Commands

### start
Start a new logging session.

```bash
node cli.ts start --task=TASK --problem=DESCRIPTION [options]
```

Options:
- `--task` - Task summary (required)
- `--problem` - Problem description (required)
- `--model` - Model name (default: $CLAUDE_MODEL or "unknown")
- `--agent` - Agent ID
- `--session` - Session ID (auto-generated if not provided)

### log-tool
Log a tool call to the current session.

```bash
node cli.ts log-tool --tool=NAME --input=JSON --output=JSON [options]
```

Options:
- `--tool` - Tool name (required)
- `--input` - Tool input as JSON
- `--output` - Tool output as JSON or string
- `--duration` - Duration in milliseconds
- `--error` - Error message (if tool failed)

### log-thought
Log an intermediate thought or reasoning step.

```bash
node cli.ts log-thought --thought=TEXT
```

### end
End the current session and save to ExpBase.

```bash
node cli.ts end --answer=TEXT [options]
```

Options:
- `--answer` - Final answer (required)
- `--outcome` - Outcome status: success, failure, or partial (default: success)
- `--score` - Outcome score 0-1 (default: 1.0 for success)
- `--explanation` - Outcome explanation
- `--tags` - Comma-separated tags
- `--context` - Additional context as JSON

### status
Show current session status.

```bash
node cli.ts status
```

### abandon
Abandon the current session without saving.

```bash
node cli.ts abandon
```

## Session State Management

The trace logger uses a temporary JSON file to persist session state between hook invocations. This allows each hook to be a separate process while maintaining continuity.

**Default location**: `/tmp/evolver-harness-session.json`

The state file contains:
- Session ID
- Task summary and problem description
- Accumulated tool calls
- Intermediate thoughts
- Session start time
- Model and agent information

## Environment Variables

### Required
- `EVOLVER_DB_PATH` - Path to ExpBase SQLite database

### Optional
- `EVOLVER_STATE_FILE` - Path to session state file (default: `/tmp/evolver-harness-session.json`)
- `CLAUDE_MODEL` - Default model name
- `CLAUDE_AGENT_ID` - Default agent ID
- `CLAUDE_SESSION_ID` - Session ID for grouping

## Integration with ExpBase

Traces are saved to ExpBase with:

- **Unique ID**: Auto-generated UUID
- **Task Summary**: High-level description of what was done
- **Problem Description**: Detailed context about the problem
- **Tool Calls**: Complete sequence of tool invocations with inputs/outputs
- **Intermediate Thoughts**: Agent's reasoning steps
- **Final Answer**: The result or solution
- **Outcome**: Success status and score
- **Duration**: Total execution time
- **Metadata**: Model used, session ID, tags, context

## Error Handling

All hooks gracefully handle errors without failing the Claude Code session:

- If the database is unavailable, hooks log errors but exit successfully
- If session state is corrupted, it can be manually removed
- Network or filesystem issues don't interrupt Claude Code operation

## Troubleshooting

### Session state file is locked
```bash
rm /tmp/evolver-harness-session.json
```

### Database is locked
```bash
# Check for other processes using the database
lsof ~/.evolver/expbase.db

# If needed, remove lock files
rm ~/.evolver/expbase.db-wal
rm ~/.evolver/expbase.db-shm
```

### Hooks not triggering
1. Verify hooks are executable: `ls -l hooks/`
2. Check `.claude/hooks.json` syntax
3. Ensure paths in hooks.json are correct
4. Check hook output: Claude Code logs hook stderr/stdout

### Testing hooks manually
```bash
# Simulate hook execution
TOOL_NAME=Read TOOL_RESULT='{"success":true}' node hooks/collect.js
```

## Advanced Usage

### Custom Database Path
```typescript
const logger = new TraceLogger('/custom/path/to/expbase.db');
```

### Custom State File
```typescript
const stateManager = new SessionStateManager('/custom/path/to/state.json');
```

### Querying Traces
```typescript
const storage = logger.getStorage();

// Get all traces
const traces = storage.getAllTraces();

// Get traces by session
const sessionTraces = storage.getTracesBySession(sessionId);

// Search traces
const results = storage.searchTraces({
  tags: ['bug-fix'],
  outcome_filter: 'success',
  limit: 10
});
```

## Future Enhancements

- Real-time trace streaming
- Web dashboard for trace visualization
- Automatic principle extraction from traces
- Integration with principle retrieval
- Multi-agent trace correlation
- Trace diffing and comparison tools

## License

ISC

