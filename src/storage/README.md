# ExpBase Storage Layer

A production-quality SQLite-based storage layer for the EvolveR experience base system.

## Features

- **Synchronous SQLite operations** using better-sqlite3 for high performance
- **Complete principle management** with usage tracking and Bayesian scoring
- **Trace logging** for agent trajectories and problem-solving episodes
- **Advanced search capabilities** with tag and triple filtering
- **Usage analytics** with automatic score calculation
- **Principle pruning** based on performance metrics
- **Transaction support** for data integrity
- **WAL mode** for better concurrency
- **Backup and optimization** utilities

## Database Schema

### Principles Table
- Stores learned strategic principles
- JSON columns: triples, tags, examples, embedding
- Tracks use_count and success_count for scoring
- Indexed on use_count, success_count, created_at, updated_at

### Traces Table
- Stores complete agent trajectories
- JSON columns: tool_calls, intermediate_thoughts, outcome, triples, tags, context
- Indexed on session_id, model_used, created_at

### Principle Usage Table
- Tracks each usage event for analytics
- Links principles to traces
- Records success/failure for scoring
- Indexed on principle_id, trace_id, created_at

## Installation

```bash
npm install better-sqlite3
npm install --save-dev @types/better-sqlite3
```

## Usage

### Initialize Storage

```typescript
import { ExpBaseStorage } from './storage/expbase.js';

const storage = new ExpBaseStorage({
  dbPath: './expbase.db',
  enableWAL: true,    // Better concurrency
  verbose: false,     // Set true for SQL logging
});
```

### Add Principles

```typescript
const principle = storage.addPrinciple({
  text: 'Always validate user input before processing',
  triples: [
    { subject: 'input', relation: 'requires', object: 'validation' }
  ],
  tags: ['security', 'validation', 'best-practice'],
  examples: [],
  confidence: 0.9,
  source: 'distilled',
});
```

### Update Principles

```typescript
storage.updatePrinciple(principleId, {
  text: 'Updated principle text',
  tags: [...existingTags, 'new-tag'],
});
```

### Add Traces

```typescript
const trace = storage.addTrace({
  task_summary: 'Implement user authentication',
  problem_description: 'Need secure JWT-based auth',
  tool_calls: [...],
  intermediate_thoughts: [...],
  final_answer: 'Implemented JWT auth with refresh tokens',
  outcome: { status: 'success', score: 0.95 },
  duration_ms: 5000,
  model_used: 'claude-sonnet-4-5-20250929',
  session_id: 'session-123',
  tags: ['authentication', 'security'],
});
```

### Record Usage

```typescript
// Record that a principle was used successfully
storage.recordUsage(principleId, traceId, true);

// Record that a principle was used but failed
storage.recordUsage(principleId, traceId, false);
```

### Calculate Scores

The system uses Bayesian scoring: `s(p) = (success_count + 1) / (use_count + 2)`

```typescript
// Get score for a single principle
const score = storage.getPrincipleScore(principleId);

// Get all principles with scores, sorted by rank
const rankedPrinciples = storage.getPrincipleScores();
```

### Search Principles

```typescript
// Search by tags
const principles = storage.searchPrinciples({
  tags: ['security', 'validation'],
  limit: 10,
});

// Search with minimum score threshold
const topPrinciples = storage.searchPrinciples({
  min_principle_score: 0.7,
  limit: 5,
});

// Search with time range
const recentPrinciples = storage.searchPrinciples({
  time_range: {
    start: '2025-01-01T00:00:00Z',
    end: '2025-12-31T23:59:59Z',
  },
});

// Search by triples
const relatedPrinciples = storage.searchPrinciples({
  triples: [
    { subject: 'input', relation: 'requires', object: 'validation' }
  ],
});
```

### Search Traces

```typescript
// Search by outcome status
const successfulTraces = storage.searchTraces({
  outcome_filter: 'success',
  limit: 20,
});

// Search by model
const claudeTraces = storage.searchTraces({
  model_filter: 'claude-sonnet-4-5-20250929',
});

// Search by session
const sessionTraces = storage.getTracesBySession('session-123');
```

### Prune Low-Performing Principles

```typescript
// Remove principles with score < 0.3 and usage >= 10
const prunedIds = storage.pruneLowScorePrinciples(0.3, 10);
console.log(`Pruned ${prunedIds.length} low-performing principles`);
```

### Get Statistics

```typescript
const stats = storage.getStats();
console.log({
  principles: stats.principle_count,
  traces: stats.trace_count,
  avgScore: stats.avg_principle_score,
  topTags: stats.top_tags,
  traceSuccessRate: stats.trace_success_rate,
});
```

### Maintenance Operations

```typescript
// Backup database
storage.backup('./backups/expbase-backup.db');

// Vacuum to reclaim space
storage.vacuum();

// Close connection
storage.close();
```

## Scoring Algorithm

Principles are scored using a Bayesian-adjusted success rate:

```
s(p) = (success_count + 1) / (use_count + 2)
```

This formula:
- Prevents division by zero for unused principles
- Provides conservative estimates for principles with limited usage
- Converges to actual success rate as usage increases
- New principles start with score of 0.5 (1/2)

## Performance Considerations

1. **WAL Mode**: Enabled by default for better concurrent read/write performance
2. **Indexes**: Comprehensive indexes on frequently queried columns
3. **Transactions**: Usage recording uses transactions for atomicity
4. **JSON Storage**: Structured data stored as JSON for flexibility
5. **Synchronous Operations**: No async overhead for fast operations

## Error Handling

All methods throw descriptive errors with the original error message:

```typescript
try {
  const principle = storage.getPrinciple('non-existent-id');
} catch (error) {
  console.error('Failed to get principle:', error.message);
}
```

## Type Safety

Full TypeScript support with types imported from `../types.ts`:

- `Principle`: Core principle structure
- `Trace`: Agent trajectory data
- `SearchQuery`: Query parameters
- `ExperienceBaseStats`: Statistics structure
- `NewPrinciple` / `NewTrace`: Helper types for creation
- `PrincipleUpdate`: Helper type for updates

## Example Application

See `example.ts` for a complete working example demonstrating all features.

## License

ISC

