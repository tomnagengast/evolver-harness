#!/usr/bin/env node
/**
 * Session End Hook for Claude Code
 *
 * This script is invoked when a Claude Code session ends.
 * It finalizes the trace logging session and saves it to ExpBase.
 *
 * Environment variables that may be available:
 * - CLAUDE_SESSION_ID: The session ID
 * - SESSION_OUTCOME: The outcome of the session (success/failure/partial)
 * - FINAL_RESPONSE: The final response from Claude
 *
 * Additional environment variables:
 * - EVOLVER_DB_PATH: Path to the ExpBase database
 * - EVOLVER_STATE_FILE: Path to the session state file
 */

import { spawn } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Read stdin for session end information
 */
async function readStdin() {
  return new Promise((resolve) => {
    let data = '';

    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      data += chunk;
    });

    process.stdin.on('end', () => {
      resolve(data);
    });

    // If stdin is empty or not available, resolve immediately
    setTimeout(() => resolve(data), 100);
  });
}

/**
 * Call the CLI to end a session
 */
function endSession(finalAnswer, outcome, options = {}) {
  return new Promise((resolve, reject) => {
    const cliPath = resolve(__dirname, '../src/logger/cli.ts');

    const args = [
      cliPath,
      'end',
      '--answer', finalAnswer,
      '--outcome', outcome,
    ];

    if (options.score !== undefined) {
      args.push('--score', options.score.toString());
    }

    if (options.explanation) {
      args.push('--explanation', options.explanation);
    }

    if (options.tags) {
      args.push('--tags', options.tags);
    }

    if (options.context) {
      args.push('--context', JSON.stringify(options.context));
    }

    if (process.env.EVOLVER_DB_PATH) {
      args.push('--dbPath', process.env.EVOLVER_DB_PATH);
    }

    if (process.env.EVOLVER_STATE_FILE) {
      args.push('--stateFile', process.env.EVOLVER_STATE_FILE);
    }

    const child = spawn('node', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`CLI exited with code ${code}: ${stderr}`));
      } else {
        resolve({ stdout, stderr });
      }
    });

    child.on('error', (error) => {
      reject(error);
    });
  });
}

/**
 * Main hook handler
 */
async function main() {
  try {
    // Read stdin for session end information
    const stdinData = await readStdin();

    let finalAnswer = 'Session completed';
    let outcome = 'success';
    let score;
    let explanation;
    let tags;
    let context;

    // Extract information from stdin if available
    if (stdinData) {
      try {
        const parsed = JSON.parse(stdinData);
        if (parsed.answer) {
          finalAnswer = parsed.answer;
        }
        if (parsed.outcome) {
          outcome = parsed.outcome;
        }
        if (parsed.score !== undefined) {
          score = parsed.score;
        }
        if (parsed.explanation) {
          explanation = parsed.explanation;
        }
        if (parsed.tags) {
          tags = Array.isArray(parsed.tags) ? parsed.tags.join(',') : parsed.tags;
        }
        if (parsed.context) {
          context = parsed.context;
        }
      } catch (e) {
        // Stdin is not JSON, use as final answer if available
        if (stdinData.trim()) {
          finalAnswer = stdinData.trim();
        }
      }
    }

    // Check for outcome in environment
    if (process.env.SESSION_OUTCOME) {
      outcome = process.env.SESSION_OUTCOME;
    }

    // Check for final response in environment
    if (process.env.FINAL_RESPONSE) {
      finalAnswer = process.env.FINAL_RESPONSE;
    }

    // Infer score from outcome if not provided
    if (score === undefined) {
      score = outcome === 'success' ? 1.0 : outcome === 'failure' ? 0.0 : 0.5;
    }

    const options = {
      score,
      explanation,
      tags,
      context,
    };

    // End the session
    const result = await endSession(finalAnswer, outcome, options);
    console.log('Session ended:', result.stdout);

  } catch (error) {
    // Don't fail the hook if logging fails
    console.error('Error in session-end hook:', error instanceof Error ? error.message : String(error));
    process.exit(0);
  }
}

main();

