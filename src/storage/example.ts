/**
 * Example usage of the ExpBase storage layer
 */

import { ExpBaseStorage } from './expbase.js';
import { NewPrinciple, NewTrace } from '../types.js';

// Initialize the storage
const storage = new ExpBaseStorage({
  dbPath: './expbase.db',
  enableWAL: true,
  verbose: false,
});

// Example 1: Add a principle
const newPrinciple: NewPrinciple = {
  text: 'When debugging, always check error logs first before modifying code',
  triples: [
    { subject: 'debugging', relation: 'requires', object: 'error_logs' },
    { subject: 'error_logs', relation: 'precedes', object: 'code_modification' },
  ],
  tags: ['debugging', 'best-practice', 'error-handling'],
  examples: [],
  confidence: 0.85,
  source: 'manual',
};

const principle = storage.addPrinciple(newPrinciple);
console.log('Added principle:', principle.id);

// Example 2: Add a trace
const newTrace: NewTrace = {
  task_summary: 'Debug authentication failure',
  problem_description: 'Users unable to login with correct credentials',
  tool_calls: [
    {
      tool: 'read_logs',
      input: { file: '/var/log/auth.log' },
      output: { lines: ['ERROR: JWT token expired', 'ERROR: Invalid signature'] },
      timestamp: new Date().toISOString(),
      duration_ms: 150,
    },
    {
      tool: 'fix_code',
      input: { file: 'auth.ts', line: 42 },
      output: { success: true },
      timestamp: new Date().toISOString(),
      duration_ms: 500,
    },
  ],
  intermediate_thoughts: [
    'Check authentication logs for errors',
    'Found JWT token expiration issue',
    'Updated token refresh logic',
  ],
  final_answer: 'Fixed JWT token refresh mechanism',
  outcome: {
    status: 'success',
    score: 0.95,
    explanation: 'Authentication now works correctly',
  },
  duration_ms: 650,
  model_used: 'claude-sonnet-4-5-20250929',
  session_id: 'session-123',
  tags: ['debugging', 'authentication', 'jwt'],
};

const trace = storage.addTrace(newTrace);
console.log('Added trace:', trace.id);

// Example 3: Record principle usage
const usageEvent = storage.recordUsage(principle.id, trace.id, true);
console.log('Recorded usage:', usageEvent.id);

// Example 4: Get principle score
const score = storage.getPrincipleScore(principle.id);
console.log('Principle score:', score);

// Example 5: Search principles by tag
const debuggingPrinciples = storage.searchPrinciples({
  tags: ['debugging'],
  limit: 10,
});
console.log('Found principles:', debuggingPrinciples.length);

// Example 6: Get statistics
const stats = storage.getStats();
console.log('Experience base stats:', {
  principles: stats.principle_count,
  traces: stats.trace_count,
  avgScore: stats.avg_principle_score.toFixed(3),
});

// Example 7: Prune low-scoring principles
const prunedIds = storage.pruneLowScorePrinciples(0.3, 5);
console.log('Pruned principles:', prunedIds.length);

// Example 8: Backup database
storage.backup('./expbase.backup.db');
console.log('Database backed up');

// Close the database when done
storage.close();

