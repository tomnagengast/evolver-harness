#!/usr/bin/env node
/**
 * TraceLogger - Accumulates tool calls and thoughts during a Claude Code session
 * and saves completed traces to ExpBase storage.
 */

import { randomUUID } from 'crypto';
import { ToolCall, Trace, TraceOutcome, NewTrace } from '../types.js';
import { ExpBaseStorage } from '../storage/expbase.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Represents an active logging session
 */
export interface LogSession {
  id: string;
  taskSummary: string;
  problemDescription: string;
  toolCalls: ToolCall[];
  intermediateThoughts: string[];
  startTime: number;
  modelUsed: string;
  agentId?: string;
}

/**
 * TraceLogger manages the accumulation of tool calls and thoughts
 * during a session and persists them to ExpBase when complete.
 */
export class TraceLogger {
  private storage: ExpBaseStorage;
  private currentSession: LogSession | null = null;

  constructor(dbPath: string) {
    this.storage = new ExpBaseStorage({ dbPath });
  }

  /**
   * Start a new logging session
   */
  startSession(
    taskSummary: string,
    problemDescription: string,
    options?: { modelUsed?: string; agentId?: string; sessionId?: string }
  ): LogSession {
    if (this.currentSession) {
      throw new Error('A session is already active. Call endSession() first.');
    }

    this.currentSession = {
      id: options?.sessionId || randomUUID(),
      taskSummary,
      problemDescription,
      toolCalls: [],
      intermediateThoughts: [],
      startTime: Date.now(),
      modelUsed: options?.modelUsed || 'unknown',
      agentId: options?.agentId,
    };

    return this.currentSession;
  }

  /**
   * Log a tool call to the current session
   */
  logToolCall(
    tool: string,
    input: Record<string, unknown>,
    output: unknown,
    options?: { timestamp?: string; durationMs?: number; error?: { message: string; code?: string; stack?: string } }
  ): void {
    if (!this.currentSession) {
      throw new Error('No active session. Call startSession() first.');
    }

    const toolCall: ToolCall = {
      tool,
      input,
      output,
      timestamp: options?.timestamp || new Date().toISOString(),
      duration_ms: options?.durationMs,
      error: options?.error,
    };

    this.currentSession.toolCalls.push(toolCall);
  }

  /**
   * Log an intermediate thought or reasoning step
   */
  logThought(thought: string): void {
    if (!this.currentSession) {
      throw new Error('No active session. Call startSession() first.');
    }

    this.currentSession.intermediateThoughts.push(thought);
  }

  /**
   * End the current session and save the trace to ExpBase
   */
  endSession(
    finalAnswer: string,
    outcome: TraceOutcome,
    options?: { tags?: string[]; context?: Record<string, unknown> }
  ): Trace {
    if (!this.currentSession) {
      throw new Error('No active session to end.');
    }

    const durationMs = Date.now() - this.currentSession.startTime;

    const newTrace: NewTrace = {
      task_summary: this.currentSession.taskSummary,
      problem_description: this.currentSession.problemDescription,
      tool_calls: this.currentSession.toolCalls,
      intermediate_thoughts: this.currentSession.intermediateThoughts,
      final_answer: finalAnswer,
      outcome,
      duration_ms: durationMs,
      model_used: this.currentSession.modelUsed,
      session_id: this.currentSession.id,
      agent_id: this.currentSession.agentId,
      tags: options?.tags,
      context: options?.context,
    };

    const trace = this.storage.addTrace(newTrace);
    this.currentSession = null;

    return trace;
  }

  /**
   * Get the current session (if any)
   */
  getCurrentSession(): LogSession | null {
    return this.currentSession;
  }

  /**
   * Check if a session is currently active
   */
  hasActiveSession(): boolean {
    return this.currentSession !== null;
  }

  /**
   * Abandon the current session without saving
   */
  abandonSession(): void {
    this.currentSession = null;
  }

  /**
   * Get the underlying ExpBase storage
   */
  getStorage(): ExpBaseStorage {
    return this.storage;
  }

  /**
   * Close the database connection
   */
  close(): void {
    this.storage.close();
  }
}

/**
 * Session state management for CLI persistence between hook invocations
 */
export class SessionStateManager {
  private stateFilePath: string;

  constructor(stateFilePath?: string) {
    this.stateFilePath = stateFilePath || path.join(os.tmpdir(), 'evolver-harness-session.json');
  }

  /**
   * Save session state to disk
   */
  saveState(session: LogSession): void {
    try {
      fs.writeFileSync(this.stateFilePath, JSON.stringify(session, null, 2), 'utf-8');
    } catch (error) {
      throw new Error(
        `Failed to save session state: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Load session state from disk
   */
  loadState(): LogSession | null {
    try {
      if (!fs.existsSync(this.stateFilePath)) {
        return null;
      }

      const data = fs.readFileSync(this.stateFilePath, 'utf-8');
      return JSON.parse(data) as LogSession;
    } catch (error) {
      throw new Error(
        `Failed to load session state: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Clear session state from disk
   */
  clearState(): void {
    try {
      if (fs.existsSync(this.stateFilePath)) {
        fs.unlinkSync(this.stateFilePath);
      }
    } catch (error) {
      throw new Error(
        `Failed to clear session state: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Check if session state exists
   */
  hasState(): boolean {
    return fs.existsSync(this.stateFilePath);
  }

  /**
   * Get the state file path
   */
  getStateFilePath(): string {
    return this.stateFilePath;
  }
}

