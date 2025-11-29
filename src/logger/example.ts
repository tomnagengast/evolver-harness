#!/usr/bin/env node
/**
 * Example usage of the TraceLogger
 *
 * This demonstrates how to use the TraceLogger programmatically
 * to capture agent interactions and save them to ExpBase.
 */

import { TraceLogger } from './trace-logger.js';
import * as path from 'path';
import * as os from 'os';

async function exampleUsage() {
  // Initialize the trace logger with a database path
  const dbPath = process.env.EVOLVER_DB_PATH || path.join(os.homedir(), '.evolver', 'expbase.db');
  const logger = new TraceLogger(dbPath);

  try {
    console.log('Starting trace logging example...\n');

    // Start a new session
    console.log('1. Starting session...');
    const session = logger.startSession(
      'Fix authentication bug in OAuth flow',
      'Users report that OAuth login fails with a 401 error after successful authentication with the provider',
      {
        modelUsed: 'claude-sonnet-4-5-20250929',
        agentId: 'example-agent',
      }
    );
    console.log(`   Session started with ID: ${session.id}\n`);

    // Simulate some tool calls
    console.log('2. Logging tool calls...');

    // Read a file
    logger.logToolCall(
      'Read',
      { file_path: '/Users/tom/project/src/auth/oauth.ts' },
      `export async function handleOAuthCallback(code: string) {
  const token = await exchangeCodeForToken(code);
  // BUG: Missing token validation
  return token;
}`,
      { durationMs: 150 }
    );
    console.log('   Logged Read tool call');

    // Search for related code
    logger.logToolCall(
      'Grep',
      { pattern: 'token validation', path: '/Users/tom/project/src' },
      {
        matches: [
          '/Users/tom/project/src/auth/validation.ts',
          '/Users/tom/project/src/middleware/auth.ts',
        ],
      },
      { durationMs: 320 }
    );
    console.log('   Logged Grep tool call');

    // Log some intermediate thoughts
    console.log('\n3. Logging thoughts...');
    logger.logThought(
      'The OAuth callback handler is missing token validation. ' +
        'This could allow invalid tokens to be accepted.'
    );
    console.log('   Logged thought #1');

    logger.logThought(
      'I found token validation utilities in validation.ts. ' +
        'Need to import and use validateToken() function.'
    );
    console.log('   Logged thought #2');

    // Edit the file
    logger.logToolCall(
      'Edit',
      {
        file_path: '/Users/tom/project/src/auth/oauth.ts',
        old_string: 'const token = await exchangeCodeForToken(code);\n  // BUG: Missing token validation\n  return token;',
        new_string:
          'const token = await exchangeCodeForToken(code);\n  if (!await validateToken(token)) {\n    throw new Error("Invalid OAuth token");\n  }\n  return token;',
      },
      { success: true },
      { durationMs: 200 }
    );
    console.log('   Logged Edit tool call');

    logger.logThought('Added token validation to prevent accepting invalid tokens.');
    console.log('   Logged thought #3');

    // Run tests
    logger.logToolCall(
      'Bash',
      { command: 'npm test -- auth.test.ts' },
      'All tests passed (5/5)',
      { durationMs: 2500 }
    );
    console.log('   Logged Bash tool call\n');

    // End the session successfully
    console.log('4. Ending session...');
    const trace = logger.endSession(
      'Fixed OAuth authentication bug by adding token validation in the callback handler. ' +
        'All tests pass and the fix prevents invalid tokens from being accepted.',
      {
        status: 'success',
        score: 1.0,
        explanation:
          'Successfully identified and fixed the missing token validation. ' +
          'Verified fix with passing tests.',
      },
      {
        tags: ['authentication', 'oauth', 'bug-fix', 'security'],
        context: {
          files_modified: ['/Users/tom/project/src/auth/oauth.ts'],
          tests_run: true,
          tests_passed: 5,
        },
      }
    );

    console.log(`   Session ended successfully!`);
    console.log(`   Trace ID: ${trace.id}`);
    console.log(`   Duration: ${trace.duration_ms}ms`);
    console.log(`   Tool calls: ${trace.tool_calls.length}`);
    console.log(`   Thoughts: ${trace.intermediate_thoughts.length}`);
    console.log(`   Outcome: ${trace.outcome.status} (score: ${trace.outcome.score})`);

    // Retrieve the trace from ExpBase
    console.log('\n5. Retrieving trace from ExpBase...');
    const storage = logger.getStorage();
    const retrievedTrace = storage.getTrace(trace.id);

    if (retrievedTrace) {
      console.log(`   Successfully retrieved trace ${retrievedTrace.id}`);
      console.log(`   Task: ${retrievedTrace.task_summary}`);
      console.log(`   Tags: ${retrievedTrace.tags?.join(', ')}`);
    }

    console.log('\n✓ Example completed successfully!');
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  } finally {
    // Clean up
    logger.close();
  }
}

// Run the example
if (import.meta.url === `file://${process.argv[1]}`) {
  exampleUsage();
}

