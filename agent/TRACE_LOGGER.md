# Trace Logger System - Implementation Summary

A complete trace logging system for the Evolver Harness that integrates with Claude Code hooks to automatically capture agent interactions, tool calls, and reasoning steps into ExpBase storage.

## Files Created

### Core Logger Implementation
1. **`/src/logger/trace-logger.ts`** (231 lines)
   - `TraceLogger` class - Main logging interface
   - `SessionStateManager` class - Persists session state between hook invocations
   - Methods: `startSession()`, `logToolCall()`, `logThought()`, `endSession()`
   - Integrates with ExpBase storage layer

2. **`/src/logger/cli.ts`** (344 lines)
   - Command-line interface for hook integration
   - Commands: `start`, `log-tool`, `log-thought`, `end`, `status`, `abandon`
   - Parses command-line arguments and environment variables
   - JSON output for programmatic consumption
   - Graceful error handling

3. **`/src/logger/index.ts`** (7 lines)
   - Module exports for easy importing
   - Re-exports `TraceLogger`, `SessionStateManager`, and types

### Hook Scripts (Claude Code Integration)
4. **`/hooks/collect.js`** (163 lines)
   - PostToolCall hook for Claude Code
   - Extracts tool name, input, output from environment/stdin
   - Calls CLI to log tool calls
   - Handles JSON parsing and error cases
   - Executable script with shebang

5. **`/hooks/session-start.js`** (147 lines)
   - SessionStart hook for Claude Code
   - Initializes new trace logging session
   - Reads user message and session info
   - Creates session with task summary and problem description
   - Executable script with shebang

6. **`/hooks/session-end.js`** (174 lines)
   - SessionEnd hook for Claude Code
   - Finalizes trace logging session
   - Saves complete trace to ExpBase
   - Supports outcome status, scores, tags, and context
   - Executable script with shebang

### Configuration & Documentation
7. **`/.claude/hooks.json.example`** (21 lines)
   - Example Claude Code hooks configuration
   - Defines PostToolCall, SessionStart, SessionEnd hooks
   - Environment variable configuration
   - Ready to copy to `.claude/hooks.json`

8. **`/src/logger/README.md`** (442 lines)
   - Comprehensive documentation
   - Architecture diagrams
   - Setup instructions
   - Usage examples (automatic, CLI, programmatic)
   - CLI command reference
   - Troubleshooting guide
   - Advanced usage patterns

9. **`/src/logger/example.ts`** (181 lines)
   - Complete working example
   - Demonstrates TraceLogger API
   - Simulates realistic agent workflow
   - Shows tool calls, thoughts, and session lifecycle
   - Executable demonstration script

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Claude Code Session                     │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       │ Lifecycle Hooks
                       ▼
         ┌─────────────────────────────┐
         │    session-start.js         │
         │  - Initialize session       │
         │  - Extract task/problem     │
         └─────────────┬───────────────┘
                       │
                       ▼
         ┌─────────────────────────────┐
         │      collect.js             │
         │  - Log each tool call       │
         │  - Extract tool I/O         │
         │  (Triggered for each tool)  │
         └─────────────┬───────────────┘
                       │
                       ▼
         ┌─────────────────────────────┐
         │    session-end.js           │
         │  - Finalize session         │
         │  - Save trace to ExpBase    │
         └─────────────┬───────────────┘
                       │
                       ▼
         ┌─────────────────────────────┐
         │      cli.ts                 │
         │  - Parse commands           │
         │  - Manage state file        │
         └─────────────┬───────────────┘
                       │
                       ▼
         ┌─────────────────────────────┐
         │   trace-logger.ts           │
         │  - TraceLogger class        │
         │  - Accumulate tool calls    │
         │  - SessionStateManager      │
         └─────────────┬───────────────┘
                       │
                       ▼
         ┌─────────────────────────────┐
         │    Session State File       │
         │  /tmp/evolver-session.json  │
         │  - Persists between hooks   │
         └─────────────┬───────────────┘
                       │
                       ▼
         ┌─────────────────────────────┐
         │   expbase.ts                │
         │  - ExpBaseStorage           │
         │  - addTrace()               │
         └─────────────┬───────────────┘
                       │
                       ▼
         ┌─────────────────────────────┐
         │   ExpBase Database          │
         │   ~/.evolver/expbase.db     │
         │  - SQLite storage           │
         │  - Persistent traces        │
         └─────────────────────────────┘
```

## Key Features

### 1. Automatic Hook Integration
- Seamlessly captures all Claude Code activity
- No manual intervention required once configured
- Hooks execute independently without blocking Claude

### 2. Stateful Session Management
- Maintains session state across hook invocations
- Uses temporary JSON file for persistence
- Handles concurrent sessions gracefully

### 3. Comprehensive Trace Capture
- **Tool Calls**: Complete input/output with timing
- **Thoughts**: Agent reasoning and observations
- **Metadata**: Model, session ID, tags, context
- **Outcomes**: Success status and scores

### 4. Flexible CLI Interface
- Supports both automatic (hooks) and manual usage
- JSON output for programmatic consumption
- Environment variable configuration
- Helpful error messages

### 5. ExpBase Integration
- Stores traces in SQLite database
- Queryable by session, tags, outcome
- Supports trace retrieval and analysis
- Foundation for principle extraction

### 6. Robust Error Handling
- Hooks never fail Claude Code sessions
- Graceful degradation on errors
- Clear error messages for debugging
- Recovery from corrupt state

## Usage Modes

### Automatic (via Hooks)
```bash
# 1. Copy configuration
cp .claude/hooks.json.example .claude/hooks.json

# 2. Set environment
export EVOLVER_DB_PATH="$HOME/.evolver/expbase.db"

# 3. Use Claude Code normally - traces captured automatically!
```

### Manual (via CLI)
```bash
# Start session
node src/logger/cli.ts start --task="Fix bug" --problem="Login fails"

# Log tool call
node src/logger/cli.ts log-tool --tool=Read --input='{"file":"auth.ts"}' --output='...'

# End session
node src/logger/cli.ts end --answer="Fixed" --outcome=success
```

### Programmatic (via API)
```typescript
import { TraceLogger } from './src/logger/trace-logger.js';

const logger = new TraceLogger('~/.evolver/expbase.db');
logger.startSession('Task', 'Problem');
logger.logToolCall('Read', {file: 'foo.ts'}, 'contents...');
logger.endSession('Answer', {status: 'success', score: 1.0});
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `EVOLVER_DB_PATH` | Path to ExpBase database | `~/.evolver/expbase.db` |
| `EVOLVER_STATE_FILE` | Session state file path | `/tmp/evolver-harness-session.json` |
| `CLAUDE_MODEL` | Model name | `unknown` |
| `CLAUDE_AGENT_ID` | Agent identifier | - |
| `CLAUDE_SESSION_ID` | Session identifier | Auto-generated |

## File Permissions

All scripts are executable:
- `/src/logger/cli.ts` - `rwx--x--x`
- `/src/logger/example.ts` - `rwx--x--x`
- `/hooks/collect.js` - `rwx--x--x`
- `/hooks/session-start.js` - `rwx--x--x`
- `/hooks/session-end.js` - `rwx--x--x`

## Testing

Run the example script to verify installation:
```bash
node src/logger/example.ts
```

Expected output:
```
Starting trace logging example...

1. Starting session...
   Session started with ID: <uuid>

2. Logging tool calls...
   Logged Read tool call
   Logged Grep tool call

3. Logging thoughts...
   Logged thought #1
   Logged thought #2
   Logged Edit tool call
   Logged thought #3
   Logged Bash tool call

4. Ending session...
   Session ended successfully!
   Trace ID: <uuid>
   Duration: <ms>ms
   Tool calls: 4
   Thoughts: 3
   Outcome: success (score: 1.0)

5. Retrieving trace from ExpBase...
   Successfully retrieved trace <uuid>
   Task: Fix authentication bug in OAuth flow
   Tags: authentication, oauth, bug-fix, security

✓ Example completed successfully!
```

## Type Safety

All code is fully typed with TypeScript:
- Imports types from `src/types.ts`
- Uses `Trace`, `ToolCall`, `TraceOutcome` interfaces
- Integrates with `ExpBaseStorage` class
- Type-safe throughout the stack

## Next Steps

1. **Copy hooks configuration**: `cp .claude/hooks.json.example .claude/hooks.json`
2. **Set environment variables**: Add to `.bashrc` or `.zshrc`
3. **Create database directory**: `mkdir -p ~/.evolver`
4. **Test manually**: `node src/logger/example.ts`
5. **Use Claude Code**: Traces will be captured automatically

## Future Enhancements

- Real-time trace streaming via WebSocket
- Web dashboard for trace visualization
- Automatic principle extraction from traces
- Integration with principle retrieval system
- Multi-agent trace correlation
- Trace comparison and diffing tools
- Export traces to JSON/CSV formats
- Trace replay and debugging tools

## Integration Points

### Current
- ✅ ExpBase storage layer
- ✅ Claude Code hooks
- ✅ Type system from `types.ts`

### Future
- ⬜ Principle extractor
- ⬜ Retrieval system
- ⬜ Web dashboard
- ⬜ Analytics pipeline

## License

ISC

