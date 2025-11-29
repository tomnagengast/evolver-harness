#!/usr/bin/env node
/**
 * PostToolCall Hook for Claude Code
 *
 * This script is invoked after each tool call to log it to the trace logger.
 * It extracts tool information from environment variables and stdin provided by Claude Code.
 *
 * Environment variables set by Claude Code:
 * - TOOL_NAME: Name of the tool that was called
 * - TOOL_RESULT: Result of the tool call (may be truncated for large results)
 * - TOOL_DURATION_MS: Duration of the tool call in milliseconds
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
 * Extract tool input from stdin if available
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
 * Call the CLI to log a tool call
 */
function logToolCall(tool, input, output, durationMs) {
  return new Promise((resolve, reject) => {
    const cliPath = resolve(__dirname, '../src/logger/cli.ts');

    const args = [
      cliPath,
      'log-tool',
      '--tool', tool,
    ];

    if (input) {
      args.push('--input', JSON.stringify(input));
    }

    if (output) {
      // Handle different output types
      if (typeof output === 'string') {
        args.push('--output', output);
      } else {
        args.push('--output', JSON.stringify(output));
      }
    }

    if (durationMs) {
      args.push('--duration', durationMs.toString());
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
    // Extract tool information from environment
    const toolName = process.env.TOOL_NAME;
    const toolResult = process.env.TOOL_RESULT;
    const toolDurationMs = process.env.TOOL_DURATION_MS;

    if (!toolName) {
      // No tool information available, skip logging
      console.error('Warning: TOOL_NAME not set, skipping tool call logging');
      process.exit(0);
    }

    // Try to read additional data from stdin
    const stdinData = await readStdin();

    let input = {};
    let output = toolResult;

    // Try to parse stdin as JSON for input parameters
    if (stdinData) {
      try {
        const parsed = JSON.parse(stdinData);
        if (parsed.input) {
          input = parsed.input;
        }
        if (parsed.output) {
          output = parsed.output;
        }
      } catch (e) {
        // Stdin is not JSON, ignore
      }
    }

    // Try to parse output as JSON
    if (typeof output === 'string') {
      try {
        output = JSON.parse(output);
      } catch (e) {
        // Output is not JSON, keep as string
      }
    }

    const durationMs = toolDurationMs ? parseInt(toolDurationMs, 10) : undefined;

    // Log the tool call
    await logToolCall(toolName, input, output, durationMs);

  } catch (error) {
    // Don't fail the hook if logging fails
    console.error('Error in collect hook:', error instanceof Error ? error.message : String(error));
    process.exit(0);
  }
}

main();

