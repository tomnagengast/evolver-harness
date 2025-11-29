#!/usr/bin/env node
/**
 * Session Start Hook for Claude Code
 *
 * This script is invoked when a new Claude Code session starts.
 * It initializes a new trace logging session.
 *
 * Environment variables that may be available:
 * - CLAUDE_MODEL: The model being used (e.g., "claude-sonnet-4-5-20250929")
 * - CLAUDE_AGENT_ID: The agent ID if applicable
 * - CLAUDE_SESSION_ID: The session ID
 * - USER_MESSAGE: The initial user message
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
 * Read stdin for session information
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
 * Call the CLI to start a session
 */
function startSession(taskSummary, problemDescription, options = {}) {
  return new Promise((resolve, reject) => {
    const cliPath = resolve(__dirname, '../src/logger/cli.ts');

    const args = [
      cliPath,
      'start',
      '--task', taskSummary,
      '--problem', problemDescription,
    ];

    if (options.model) {
      args.push('--model', options.model);
    }

    if (options.agent) {
      args.push('--agent', options.agent);
    }

    if (options.session) {
      args.push('--session', options.session);
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
    // Read stdin for session information
    const stdinData = await readStdin();

    let taskSummary = 'Claude Code Session';
    let problemDescription = 'User interaction session';

    // Extract information from stdin if available
    if (stdinData) {
      try {
        const parsed = JSON.parse(stdinData);
        if (parsed.task) {
          taskSummary = parsed.task;
        }
        if (parsed.problem) {
          problemDescription = parsed.problem;
        }
      } catch (e) {
        // Stdin is not JSON, use as problem description if available
        if (stdinData.trim()) {
          problemDescription = stdinData.trim();
        }
      }
    }

    // Check for user message in environment
    if (process.env.USER_MESSAGE) {
      problemDescription = process.env.USER_MESSAGE;
    }

    const options = {
      model: process.env.CLAUDE_MODEL,
      agent: process.env.CLAUDE_AGENT_ID,
      session: process.env.CLAUDE_SESSION_ID,
    };

    // Start the session
    const result = await startSession(taskSummary, problemDescription, options);
    console.log('Session started:', result.stdout);

  } catch (error) {
    // Don't fail the hook if logging fails
    console.error('Error in session-start hook:', error instanceof Error ? error.message : String(error));
    process.exit(0);
  }
}

main();

