# Principle Success Criteria: Intelligent Credit Assignment

## Problem Statement

The current success measurement (`hooks/session-end.ts:105-121`) is too coarse:

```typescript
function inferOutcome(toolCalls) {
  if (hasErrors && !hasEdits) return { status: "failure", score: 0.3 };
  if (hasEdits) return { status: "success", score: 0.8 };
  return { status: "partial", score: 0.5 };
}
```

**Issues:**
1. Binary attribution - all injected principles get the same credit
2. No user feedback - ignores whether user was satisfied
3. No temporal credit - principles from prompt 1 get same credit as prompt 5
4. Edit ≠ success - edits can be wrong; read-only tasks can succeed

## Research Foundation

| Paper | Key Insight |
|-------|-------------|
| [MT-GRPO](https://arxiv.org/html/2505.11821v1) | Turn-level credit separate from outcome rewards |
| [ExpeL](https://arxiv.org/html/2308.10144v2) | Compare success/failure trajectories; UPVOTE/DOWNVOTE |
| [LaRe](https://arxiv.org/abs/2412.11120) | LLM generates multi-dimensional rewards |
| [RAGEN](https://arxiv.org/html/2504.20073v2) | Trajectory-level with uncertainty filtering |

---

## Implementation Plan

### Phase 1: Type Definitions

**File: `src/types.ts`**

Add new types after `TraceOutcome`:

```typescript
/**
 * User feedback signal captured from prompt analysis.
 * Inferred from user's response to previous agent output.
 */
export interface UserFeedback {
  /** Sentiment score: 0 = negative, 0.5 = neutral, 1 = positive */
  sentiment: number;

  /** How the feedback was determined */
  type: 'explicit_positive' | 'explicit_negative' | 'implicit_continuation' | 'implicit_retry' | 'neutral';

  /** Confidence in the sentiment assessment (0-1) */
  confidence: number;

  /** The prompt index this feedback refers to */
  prompt_index: number;

  /** Raw patterns matched (for debugging) */
  matched_patterns?: string[];
}

/**
 * Context linking a principle to specific tool calls.
 * Enables fine-grained credit assignment.
 */
export interface PrincipleToolContext {
  /** The principle that was active */
  principle_id: string;

  /** Which prompt injected this principle (0-indexed) */
  injected_at_prompt: number;

  /** Tool calls that occurred after this principle was injected */
  tool_calls_after: Array<{
    tool: string;
    tool_index: number;
    succeeded: boolean;
    /** Prompts between injection and this tool call */
    temporal_distance: number;
  }>;
}

/**
 * Multi-dimensional outcome signals for richer success measurement.
 */
export interface OutcomeSignals {
  // Tool execution quality
  tool_success_rate: number;      // % of tools without errors
  error_count: number;            // Total errors encountered

  // Task completion indicators
  made_edits: boolean;
  edit_count: number;             // Number of Edit/Write calls
  files_touched: number;          // Unique files modified

  // User feedback signals
  user_feedback: UserFeedback[];  // All feedback captured during session
  avg_sentiment: number;          // Average user sentiment

  // Session patterns
  session_continued: boolean;     // Session didn't end abruptly after errors
  prompt_count: number;           // Total prompts in session
}

/**
 * Extended trace outcome with multi-dimensional signals.
 */
export interface EnrichedTraceOutcome extends TraceOutcome {
  /** Detailed signals that contributed to the outcome */
  signals: OutcomeSignals;

  /** Per-principle credit assignments */
  principle_credits: Array<{
    principle_id: string;
    credit: number;           // 0-1, weighted contribution
    reasoning: string;        // Why this credit was assigned
  }>;
}
```

---

### Phase 2: User Feedback Capture

**File: `hooks/prompt-submit.ts`**

Add feedback analysis function and integrate into main flow:

```typescript
/** Patterns for detecting user feedback */
const FEEDBACK_PATTERNS = {
  explicit_positive: [
    /\b(thanks|thank you|perfect|great|awesome|works|excellent|nice|good job)\b/i,
    /^(yes|yep|yeah|correct|exactly)[.!]?$/i,
  ],
  explicit_negative: [
    /\b(wrong|incorrect|no[,.]|not what|undo|revert|rollback|broken|failed)\b/i,
    /\b(try again|start over|that's not|doesn't work)\b/i,
  ],
  implicit_retry: [
    // Same keywords as recent tool calls = retry
  ],
};

function analyzeUserFeedback(
  currentPrompt: string,
  previousPrompts: string[],
  recentToolCalls: ToolCall[]
): UserFeedback {
  const promptIndex = previousPrompts.length;

  // Check explicit positive
  for (const pattern of FEEDBACK_PATTERNS.explicit_positive) {
    if (pattern.test(currentPrompt)) {
      return {
        sentiment: 1.0,
        type: 'explicit_positive',
        confidence: 0.9,
        prompt_index: promptIndex,
        matched_patterns: [pattern.source],
      };
    }
  }

  // Check explicit negative
  for (const pattern of FEEDBACK_PATTERNS.explicit_negative) {
    if (pattern.test(currentPrompt)) {
      return {
        sentiment: 0.0,
        type: 'explicit_negative',
        confidence: 0.9,
        prompt_index: promptIndex,
        matched_patterns: [pattern.source],
      };
    }
  }

  // Check implicit retry (similar to recent request)
  if (previousPrompts.length > 0) {
    const lastPrompt = previousPrompts[previousPrompts.length - 1];
    const similarity = computeKeywordOverlap(currentPrompt, lastPrompt);
    if (similarity > 0.6) {
      return {
        sentiment: 0.2,
        type: 'implicit_retry',
        confidence: 0.7,
        prompt_index: promptIndex,
      };
    }
  }

  // Check implicit continuation (new unrelated task = previous succeeded)
  if (previousPrompts.length > 0 && recentToolCalls.length > 0) {
    const lastPrompt = previousPrompts[previousPrompts.length - 1];
    const similarity = computeKeywordOverlap(currentPrompt, lastPrompt);
    if (similarity < 0.2) {
      return {
        sentiment: 0.7,
        type: 'implicit_continuation',
        confidence: 0.6,
        prompt_index: promptIndex,
      };
    }
  }

  return {
    sentiment: 0.5,
    type: 'neutral',
    confidence: 0.5,
    prompt_index: promptIndex,
  };
}

function computeKeywordOverlap(a: string, b: string): number {
  const wordsA = new Set(a.toLowerCase().split(/\W+/).filter(w => w.length > 3));
  const wordsB = new Set(b.toLowerCase().split(/\W+/).filter(w => w.length > 3));
  if (wordsA.size === 0 || wordsB.size === 0) return 0;

  const intersection = [...wordsA].filter(w => wordsB.has(w)).length;
  const union = new Set([...wordsA, ...wordsB]).size;
  return intersection / union;
}
```

**Session state update:**

```typescript
// In main(), after principle retrieval:
const feedback = analyzeUserFeedback(prompt, state.prompts || [], state.toolCalls || []);
if (!state.userFeedback) state.userFeedback = [];
state.userFeedback.push(feedback);
```

---

### Phase 3: Principle-Tool Context Tracking

**File: `hooks/post-tool-use.ts`**

Track which principles were active at each tool call:

```typescript
interface EnrichedToolCall {
  tool: string;
  input: Record<string, unknown>;
  output: unknown;
  timestamp: string;
  succeeded: boolean;                    // NEW
  active_principles: string[];           // NEW - principles injected before this call
  prompt_index: number;                  // NEW - which prompt triggered this
}

function determineToolSuccess(toolName: string, output: unknown): boolean {
  const outStr = typeof output === 'string' ? output : JSON.stringify(output);

  // Check for error patterns
  if (/error|failed|exception|denied/i.test(outStr)) {
    return false;
  }

  // Tool-specific success heuristics
  if (toolName === 'Bash') {
    // Check exit code if available
    if (/exit code: [1-9]/i.test(outStr)) return false;
  }

  return true;
}

// In main():
const succeeded = determineToolSuccess(input.tool_name, input.tool_response);

state.toolCalls.push({
  tool: input.tool_name,
  input: input.tool_input || {},
  output: truncate(input.tool_response),
  timestamp: new Date().toISOString(),
  succeeded,
  active_principles: state.injectedPrinciples || [],
  prompt_index: (state.prompts?.length || 1) - 1,
});
```

---

### Phase 4: Multi-Dimensional Outcome Scoring

**File: `hooks/session-end.ts`**

Replace `inferOutcome()` with richer scoring:

```typescript
function computeOutcomeSignals(state: SessionState): OutcomeSignals {
  const toolCalls = state.toolCalls || [];
  const userFeedback = state.userFeedback || [];

  // Tool success rate
  const succeededTools = toolCalls.filter(tc => tc.succeeded !== false);
  const tool_success_rate = toolCalls.length > 0
    ? succeededTools.length / toolCalls.length
    : 1;

  // Error count
  const error_count = toolCalls.filter(tc => {
    const out = typeof tc.output === 'string' ? tc.output : JSON.stringify(tc.output);
    return /error|failed/i.test(out);
  }).length;

  // Edit metrics
  const editTools = ['Edit', 'Write', 'NotebookEdit'];
  const edits = toolCalls.filter(tc => editTools.includes(tc.tool));
  const made_edits = edits.length > 0;
  const edit_count = edits.length;

  // Files touched
  const files = new Set<string>();
  for (const tc of edits) {
    const filePath = tc.input?.file_path || tc.input?.path;
    if (typeof filePath === 'string') files.add(filePath);
  }
  const files_touched = files.size;

  // User feedback
  const avg_sentiment = userFeedback.length > 0
    ? userFeedback.reduce((sum, f) => sum + f.sentiment, 0) / userFeedback.length
    : 0.5;

  return {
    tool_success_rate,
    error_count,
    made_edits,
    edit_count,
    files_touched,
    user_feedback: userFeedback,
    avg_sentiment,
    session_continued: toolCalls.length > 0,
    prompt_count: state.prompts?.length || 0,
  };
}

function inferEnrichedOutcome(state: SessionState): EnrichedTraceOutcome {
  const signals = computeOutcomeSignals(state);

  // Weighted score from multiple dimensions
  const weights = {
    tool_success: 0.25,
    user_sentiment: 0.35,
    made_edits: 0.20,
    no_errors: 0.20,
  };

  const score =
    weights.tool_success * signals.tool_success_rate +
    weights.user_sentiment * signals.avg_sentiment +
    weights.made_edits * (signals.made_edits ? 0.8 : 0.3) +
    weights.no_errors * (signals.error_count === 0 ? 1 : Math.max(0, 1 - signals.error_count * 0.2));

  // Determine status from score
  let status: 'success' | 'failure' | 'partial';
  if (score >= 0.65) status = 'success';
  else if (score <= 0.35) status = 'failure';
  else status = 'partial';

  return {
    status,
    score,
    signals,
    principle_credits: [], // Filled in by credit assignment
  };
}
```

---

### Phase 5: Credit Assignment

**File: `hooks/session-end.ts`**

Add credit calculation for each principle:

```typescript
interface PrincipleCredit {
  principle_id: string;
  credit: number;
  reasoning: string;
}

function calculatePrincipleCredits(
  state: SessionState,
  outcome: EnrichedTraceOutcome
): PrincipleCredit[] {
  const credits: PrincipleCredit[] = [];
  const principleIds = state.injectedPrinciples || [];

  if (principleIds.length === 0) return credits;

  // Build principle -> tool success mapping
  const principleToolSuccess = new Map<string, { succeeded: number; failed: number; total: number }>();

  for (const pId of principleIds) {
    principleToolSuccess.set(pId, { succeeded: 0, failed: 0, total: 0 });
  }

  // For each tool call, credit active principles
  for (const tc of state.toolCalls || []) {
    const activePrinciples = tc.active_principles || principleIds;
    for (const pId of activePrinciples) {
      const stats = principleToolSuccess.get(pId);
      if (stats) {
        stats.total++;
        if (tc.succeeded !== false) stats.succeeded++;
        else stats.failed++;
      }
    }
  }

  // Calculate credit for each principle
  for (const pId of principleIds) {
    const stats = principleToolSuccess.get(pId)!;
    const reasons: string[] = [];

    // Base credit from outcome
    let credit = outcome.score;

    // Adjust by tool success rate for this principle
    if (stats.total > 0) {
      const principleToolRate = stats.succeeded / stats.total;
      credit = credit * 0.6 + principleToolRate * 0.4;
      reasons.push(`tool_success=${(principleToolRate * 100).toFixed(0)}%`);
    }

    // Boost/penalize based on user feedback
    const feedback = outcome.signals.user_feedback;
    if (feedback.length > 0) {
      const avgSentiment = feedback.reduce((s, f) => s + f.sentiment, 0) / feedback.length;
      credit = credit * 0.7 + avgSentiment * 0.3;
      reasons.push(`user_sentiment=${(avgSentiment * 100).toFixed(0)}%`);
    }

    credits.push({
      principle_id: pId,
      credit: Math.max(0, Math.min(1, credit)),
      reasoning: reasons.join(', ') || 'base_outcome',
    });
  }

  return credits;
}
```

---

### Phase 6: Storage Updates

**File: `src/storage/expbase.ts`**

Update `recordUsage()` to accept weighted credit:

```typescript
recordUsage(
  principleId: string,
  traceId: string | undefined,
  credit: number,  // Changed from boolean to number (0-1)
): PrincipleUsageEvent {
  const runTransaction = this.db.transaction(() => {
    const event: PrincipleUsageEvent = {
      id: randomUUID(),
      principle_id: principleId,
      trace_id: traceId,
      was_successful: credit >= 0.5,  // Backward compat
      credit,                          // NEW
      created_at: new Date().toISOString(),
    };

    const usageStmt = this.db.query(`
      INSERT INTO principle_usage (id, principle_id, trace_id, was_successful, credit, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    usageStmt.run(event.id, event.principle_id, event.trace_id ?? null,
                  credit >= 0.5 ? 1 : 0, credit, event.created_at);

    // Update principle with weighted credit
    const updateStmt = this.db.query(`
      UPDATE principles
      SET use_count = use_count + 1,
          success_count = success_count + ?,
          updated_at = ?
      WHERE id = ?
    `);
    updateStmt.run(credit, event.created_at, principleId);

    return event;
  });

  return runTransaction();
}
```

**Schema migration** (add to initialization):

```sql
ALTER TABLE principle_usage ADD COLUMN credit REAL DEFAULT 0.5;
```

---

### Phase 7: Integration

**File: `hooks/session-end.ts`**

Update main() to use new credit system:

```typescript
// Replace existing usage recording with:
const outcome = inferEnrichedOutcome(state);
const credits = calculatePrincipleCredits(state, outcome);

for (const { principle_id, credit, reasoning } of credits) {
  try {
    storage.recordUsage(principle_id, trace.id, credit);
    if (VERBOSE) {
      console.error(`[evolver] ${principle_id}: credit=${credit.toFixed(2)} (${reasoning})`);
    }
  } catch {
    // Principle may have been deleted
  }
}
```

---

## Session State Schema

Updated `SessionState` interface used across hooks:

```typescript
interface SessionState {
  sessionId: string;
  startTime: string;
  prompts: string[];
  injectedPrinciples: string[];
  toolCalls: Array<{
    tool: string;
    input: Record<string, unknown>;
    output: unknown;
    timestamp: string;
    succeeded: boolean;
    active_principles: string[];
    prompt_index: number;
  }>;
  userFeedback: UserFeedback[];
}
```

---

## Testing Checklist

- [ ] Types compile without errors
- [ ] User feedback detection works for explicit positive/negative
- [ ] User feedback detection works for implicit retry/continuation
- [ ] Tool success detection handles error patterns
- [ ] Multi-dimensional score produces reasonable values
- [ ] Credit assignment distributes credit appropriately
- [ ] Storage accepts fractional credits
- [ ] Existing functionality not broken (backward compat)

---

## Files Modified

| File | Changes |
|------|---------|
| `src/types.ts` | Add UserFeedback, PrincipleToolContext, OutcomeSignals, EnrichedTraceOutcome |
| `hooks/prompt-submit.ts` | Add analyzeUserFeedback(), store in session state |
| `hooks/post-tool-use.ts` | Track succeeded, active_principles, prompt_index |
| `hooks/session-end.ts` | Replace inferOutcome with computeOutcomeSignals + calculatePrincipleCredits |
| `src/storage/expbase.ts` | Update recordUsage() for weighted credit, add migration |
