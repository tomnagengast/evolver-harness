/**
 * EvolverOrchestrator - Main orchestration layer for experience-augmented sessions
 *
 * Coordinates between:
 * - ExpBase storage (retrieval)
 * - TraceLogger (logging)
 * - Contract injection (system prompt augmentation)
 * - Claude Code session lifecycle
 */

import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  cosineSimilarity,
  generateEmbedding,
} from "../distiller/embeddings.js";
import { type LogSession, TraceLogger } from "../logger/trace-logger.js";
import { ExpBaseStorage } from "../storage/expbase.js";
import type { Principle, SearchQuery, Trace } from "../types.js";
import {
  DEFAULT_SEARCH_CONFIG,
  EVOLVER_SYSTEM_PROMPT,
  formatPrincipleForDisplay,
} from "./contract.js";

/**
 * Configuration for the orchestrator
 */
export interface OrchestratorConfig {
  /** Path to ExpBase database */
  dbPath: string;

  /** Enable semantic search via embeddings */
  enableEmbeddings?: boolean;

  /** Embedding provider configuration */
  embeddingConfig?: {
    provider?: "openai" | "mock";
    apiKey?: string;
    model?: string;
  };

  /** Path to inject context (defaults to ~/.evolver/context.md) */
  contextFilePath?: string;

  /** Maximum number of principles to inject into context */
  maxPrinciplesInContext?: number;

  /** Minimum principle score to inject into context */
  minPrincipleScoreForContext?: number;

  /** Enable verbose logging */
  verbose?: boolean;
}

/**
 * Session context that gets injected into Claude Code
 */
export interface SessionContext {
  /** Retrieved principles relevant to the task */
  principles: Principle[];

  /** System prompt addition */
  systemPrompt: string;

  /** Session metadata */
  sessionId: string;
  taskDescription: string;
  timestamp: string;
}

/**
 * Result from searching experience base
 */
export interface SearchExperienceResult {
  results: Array<{
    type: "principle" | "trace";
    item: Principle | Trace;
    similarity_score?: number;
    match_reason?: string;
  }>;
  total_count: number;
  query_time_ms: number;
}

/**
 * EvolverOrchestrator - orchestrates experience-augmented Claude Code sessions
 */
export class EvolverOrchestrator {
  private storage: ExpBaseStorage;
  private logger: TraceLogger;
  private config: Required<OrchestratorConfig>;
  private currentContext: SessionContext | null = null;

  constructor(config: OrchestratorConfig) {
    this.config = {
      enableEmbeddings: false,
      embeddingConfig: { provider: "mock" },
      contextFilePath: path.join(os.homedir(), ".evolver", "context.md"),
      maxPrinciplesInContext: 10,
      minPrincipleScoreForContext: 0.6,
      verbose: false,
      ...config,
    };

    this.storage = new ExpBaseStorage({ dbPath: this.config.dbPath });
    this.logger = new TraceLogger(this.config.dbPath);

    if (this.config.verbose) {
      console.error("[EvolverOrchestrator] Initialized with config:", {
        dbPath: this.config.dbPath,
        enableEmbeddings: this.config.enableEmbeddings,
        contextFilePath: this.config.contextFilePath,
      });
    }
  }

  /**
   * Wrap a Claude Code session with experience-based context
   * This is the main entry point for the orchestrator
   */
  async wrapSession(
    taskDescription: string,
    options?: { sessionId?: string },
  ): Promise<SessionContext> {
    const sessionId = options?.sessionId || randomUUID();
    const startTime = Date.now();

    if (this.config.verbose) {
      console.error(`[EvolverOrchestrator] Wrapping session ${sessionId}`);
      console.error(`[EvolverOrchestrator] Task: ${taskDescription}`);
    }

    // Retrieve relevant principles for the task
    const principles = await this.retrieveRelevantPrinciples(taskDescription);

    if (this.config.verbose) {
      console.error(
        `[EvolverOrchestrator] Retrieved ${principles.length} relevant principles (${Date.now() - startTime}ms)`,
      );
    }

    // Create session context
    const context: SessionContext = {
      principles,
      systemPrompt: EVOLVER_SYSTEM_PROMPT,
      sessionId,
      taskDescription,
      timestamp: new Date().toISOString(),
    };

    this.currentContext = context;

    // Inject context into file system for Claude Code to pick up
    await this.injectContext(context);

    if (this.config.verbose) {
      console.error(
        `[EvolverOrchestrator] Context injected to ${this.config.contextFilePath}`,
      );
    }

    return context;
  }

  /**
   * Pre-session preparation: retrieve relevant principles before Claude Code session
   * Returns principles that should be injected into context
   */
  async preSession(
    taskDescription: string,
    options?: { sessionId?: string },
  ): Promise<{
    sessionId: string;
    principles: Principle[];
    timestamp: string;
  }> {
    const sessionId = options?.sessionId || randomUUID();
    const startTime = Date.now();

    if (this.config.verbose) {
      console.error(`[EvolverOrchestrator] Pre-session for ${sessionId}`);
      console.error(`[EvolverOrchestrator] Task: ${taskDescription}`);
    }

    // Retrieve relevant principles
    const principles = await this.retrieveRelevantPrinciples(taskDescription);

    if (this.config.verbose) {
      console.error(
        `[EvolverOrchestrator] Retrieved ${principles.length} principles (${Date.now() - startTime}ms)`,
      );
    }

    // Store context for later use
    const context: SessionContext = {
      principles,
      systemPrompt: EVOLVER_SYSTEM_PROMPT,
      sessionId,
      taskDescription,
      timestamp: new Date().toISOString(),
    };

    this.currentContext = context;

    return {
      sessionId,
      principles,
      timestamp: context.timestamp,
    };
  }

  /**
   * Post-session completion: update principle scores and log trajectory
   * Should be called after Claude Code session completes
   */
  async postSession(outcome: {
    status: "success" | "failure" | "partial";
    score: number;
    explanation?: string;
  }): Promise<{
    principlesUpdated: number;
    traceId?: string;
  }> {
    if (this.config.verbose) {
      console.error(
        `[EvolverOrchestrator] Post-session with outcome: ${outcome.status}`,
      );
    }

    if (!this.currentContext) {
      if (this.config.verbose) {
        console.error("[EvolverOrchestrator] No active context to update");
      }
      return { principlesUpdated: 0 };
    }

    const wasSuccessful = outcome.status === "success";
    const principles = this.currentContext.principles;

    // Update principle usage statistics
    let principlesUpdated = 0;
    let traceId: string | undefined;

    // If we have an active logger session, finalize it
    const currentSession = this.logger.getCurrentSession();
    if (currentSession) {
      try {
        const trace = this.logger.endSession("Session completed", outcome, {
          tags: ["orchestrated"],
          context: { taskDescription: this.currentContext.taskDescription },
        });
        traceId = trace.id;

        if (this.config.verbose) {
          console.error(`[EvolverOrchestrator] Trace saved: ${traceId}`);
        }
      } catch (error) {
        if (this.config.verbose) {
          console.error("[EvolverOrchestrator] Failed to save trace:", error);
        }
      }
    }

    // Update each principle's usage statistics
    for (const principle of principles) {
      try {
        this.storage.recordUsage(principle.id, traceId, wasSuccessful);
        principlesUpdated++;

        if (this.config.verbose) {
          console.error(
            `[EvolverOrchestrator] Updated principle ${principle.id}: ${wasSuccessful ? "success" : "failure"}`,
          );
        }
      } catch (error) {
        if (this.config.verbose) {
          console.error(
            `[EvolverOrchestrator] Failed to update principle ${principle.id}:`,
            error,
          );
        }
      }
    }

    // Clear current context
    this.currentContext = null;

    if (this.config.verbose) {
      console.error(
        `[EvolverOrchestrator] Post-session complete: ${principlesUpdated} principles updated`,
      );
    }

    return {
      principlesUpdated,
      traceId,
    };
  }

  /**
   * Generate context injection text for CLAUDE.md or system prompt
   * Returns formatted text with reasoning contract and retrieved principles
   */
  generateContextInjection(): string {
    if (!this.currentContext) {
      return EVOLVER_SYSTEM_PROMPT;
    }

    const lines: string[] = [];

    // Add reasoning contract
    lines.push(EVOLVER_SYSTEM_PROMPT);
    lines.push("");

    // Add retrieved principles
    if (this.currentContext.principles.length > 0) {
      lines.push("## Retrieved Principles for This Session");
      lines.push("");
      lines.push(
        `The following ${this.currentContext.principles.length} principles are relevant to your current task:`,
      );
      lines.push("");

      for (const principle of this.currentContext.principles) {
        lines.push("---");
        lines.push("");
        lines.push(formatPrincipleForDisplay(principle));
        lines.push("");
      }
    }

    return lines.join("\n");
  }

  /**
   * Retrieve principles relevant to the given task
   * Uses semantic search if embeddings are enabled, otherwise uses tag/text search
   */
  async retrieveRelevantPrinciples(task: string): Promise<Principle[]> {
    if (this.config.enableEmbeddings) {
      return this.retrieveWithEmbeddings(task);
    } else {
      return this.retrieveWithTextSearch(task);
    }
  }

  /**
   * Retrieve principles using semantic embeddings
   */
  private async retrieveWithEmbeddings(task: string): Promise<Principle[]> {
    try {
      // Generate embedding for the task
      const taskEmbedding = await generateEmbedding(
        task,
        this.config.embeddingConfig,
      );

      // Get all principles with embeddings
      const allPrinciples = this.storage
        .getAllPrinciples()
        .filter((p) => p.embedding);

      // Calculate similarities
      const scored = allPrinciples.map((principle) => ({
        principle,
        similarity: principle.embedding
          ? cosineSimilarity(taskEmbedding, principle.embedding)
          : 0,
      }));

      // Filter and sort
      const filtered = scored
        .filter((s) => s.similarity >= DEFAULT_SEARCH_CONFIG.minSimilarity)
        .filter((s) => {
          const score =
            (s.principle.success_count + 1) / (s.principle.use_count + 2);
          return score >= this.config.minPrincipleScoreForContext;
        })
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, this.config.maxPrinciplesInContext);

      return filtered.map((s) => s.principle);
    } catch (error) {
      if (this.config.verbose) {
        console.error(
          "[EvolverOrchestrator] Embedding search failed, falling back to text search:",
          error,
        );
      }
      return this.retrieveWithTextSearch(task);
    }
  }

  /**
   * Retrieve principles using simple text/tag matching
   */
  private async retrieveWithTextSearch(task: string): Promise<Principle[]> {
    // Extract potential tags from task description
    const words = task.toLowerCase().split(/\s+/);
    const commonWords = new Set([
      "the",
      "a",
      "an",
      "and",
      "or",
      "but",
      "in",
      "on",
      "at",
      "to",
      "for",
      "with",
    ]);
    const potentialTags = words.filter(
      (w) => w.length > 3 && !commonWords.has(w),
    );

    // Search by tags
    const query: SearchQuery = {
      tags: potentialTags,
      limit: this.config.maxPrinciplesInContext * 2, // Get extra to filter by score
      min_principle_score: this.config.minPrincipleScoreForContext,
      search_mode: "principles",
    };

    const principles = this.storage.searchPrinciples(query);

    // Sort by principle score and take top N
    const scored = principles
      .map((p) => ({
        principle: p,
        score: (p.success_count + 1) / (p.use_count + 2),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, this.config.maxPrinciplesInContext);

    return scored.map((s) => s.principle);
  }

  /**
   * Inject context into file system for Claude Code to pick up
   * Writes a markdown file with system prompt and retrieved principles
   */
  async injectContext(context: SessionContext): Promise<void> {
    const lines: string[] = [];

    // Header
    lines.push("# Evolver Experience Context");
    lines.push("");
    lines.push(`Session: ${context.sessionId}`);
    lines.push(`Task: ${context.taskDescription}`);
    lines.push(`Generated: ${context.timestamp}`);
    lines.push("");

    // System prompt
    lines.push("## Reasoning Contract");
    lines.push("");
    lines.push(context.systemPrompt);
    lines.push("");

    // Retrieved principles
    if (context.principles.length > 0) {
      lines.push("## Retrieved Principles");
      lines.push("");
      lines.push(
        `Found ${context.principles.length} relevant principles from experience base:`,
      );
      lines.push("");

      for (const principle of context.principles) {
        lines.push("---");
        lines.push("");
        lines.push(formatPrincipleForDisplay(principle));
        lines.push("");
      }
    } else {
      lines.push("## Retrieved Principles");
      lines.push("");
      lines.push("No relevant principles found. This may be a novel task.");
      lines.push("");
    }

    // Write to file
    const content = lines.join("\n");
    const dir = path.dirname(this.config.contextFilePath);

    // Ensure directory exists
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(this.config.contextFilePath, content, "utf-8");
  }

  /**
   * Search the experience base (used by the search_experience tool)
   */
  async searchExperience(query: SearchQuery): Promise<SearchExperienceResult> {
    const startTime = Date.now();

    // Determine search mode
    const searchMode = query.search_mode || "both";

    // Set defaults
    const limit = Math.min(
      query.limit || DEFAULT_SEARCH_CONFIG.limit,
      DEFAULT_SEARCH_CONFIG.maxLimit,
    );
    const minSimilarity =
      query.min_similarity ?? DEFAULT_SEARCH_CONFIG.minSimilarity;
    const minPrincipleScore =
      query.min_principle_score ?? DEFAULT_SEARCH_CONFIG.minPrincipleScore;

    const results: Array<{
      type: "principle" | "trace";
      item: Principle | Trace;
      similarity_score?: number;
      match_reason?: string;
    }> = [];

    // Search principles
    if (searchMode === "principles" || searchMode === "both") {
      const principleQuery: SearchQuery = {
        ...query,
        search_mode: "principles",
        limit,
        min_similarity: minSimilarity,
        min_principle_score: minPrincipleScore,
      };

      let principles: Principle[] = [];

      // Use embeddings if enabled and query_text is provided
      if (this.config.enableEmbeddings && query.query_text) {
        try {
          const queryEmbedding = await generateEmbedding(
            query.query_text,
            this.config.embeddingConfig,
          );
          const allPrinciples = this.storage.searchPrinciples(principleQuery);

          const scored = allPrinciples
            .filter((p) => p.embedding)
            .map((p) => ({
              principle: p,
              similarity: p.embedding
                ? cosineSimilarity(queryEmbedding, p.embedding)
                : 0,
            }))
            .filter((s) => s.similarity >= minSimilarity)
            .sort((a, b) => b.similarity - a.similarity)
            .slice(0, limit);

          for (const { principle, similarity } of scored) {
            results.push({
              type: "principle",
              item: principle,
              similarity_score: similarity,
              match_reason: `Semantic similarity: ${similarity.toFixed(3)}`,
            });
          }
        } catch (error) {
          if (this.config.verbose) {
            console.error(
              "[EvolverOrchestrator] Embedding search failed:",
              error,
            );
          }
          // Fall through to text search
          principles = this.storage.searchPrinciples(principleQuery);
        }
      } else {
        principles = this.storage.searchPrinciples(principleQuery);
      }

      // Add text-based results if no embedding results
      if (results.length === 0) {
        for (const principle of principles.slice(0, limit)) {
          results.push({
            type: "principle",
            item: principle,
            match_reason: query.tags
              ? `Matched tags: ${query.tags.join(", ")}`
              : "Tag/text match",
          });
        }
      }
    }

    // Search traces
    if (searchMode === "traces" || searchMode === "both") {
      const traceQuery: SearchQuery = {
        ...query,
        search_mode: "traces",
        limit,
      };

      const traces = this.storage.searchTraces(traceQuery);

      for (const trace of traces.slice(0, limit)) {
        results.push({
          type: "trace",
          item: trace,
          match_reason: query.tags
            ? `Matched tags: ${query.tags.join(", ")}`
            : query.outcome_filter
              ? `Outcome: ${query.outcome_filter}`
              : "Tag/outcome match",
        });
      }
    }

    // Sort by similarity score if available, otherwise by type (principles first)
    results.sort((a, b) => {
      if (
        a.similarity_score !== undefined &&
        b.similarity_score !== undefined
      ) {
        return b.similarity_score - a.similarity_score;
      }
      return a.type === "principle" && b.type === "trace" ? -1 : 1;
    });

    // Apply overall limit
    const limitedResults = results.slice(0, limit);

    const queryTimeMs = Date.now() - startTime;

    if (this.config.verbose) {
      console.error(
        `[EvolverOrchestrator] Search completed in ${queryTimeMs}ms, found ${limitedResults.length} results`,
      );
    }

    return {
      results: limitedResults,
      total_count: results.length,
      query_time_ms: queryTimeMs,
    };
  }

  /**
   * Start a new session (initializes trace logging)
   */
  startSession(
    taskDescription: string,
    problemDescription: string,
    options?: { sessionId?: string; modelUsed?: string; agentId?: string },
  ): LogSession {
    if (this.config.verbose) {
      console.error("[EvolverOrchestrator] Starting session");
    }

    return this.logger.startSession(
      taskDescription,
      problemDescription,
      options,
    );
  }

  /**
   * End the current session (saves trace to ExpBase)
   */
  endSession(
    finalAnswer: string,
    outcome: {
      status: "success" | "failure" | "partial";
      score: number;
      explanation?: string;
    },
    options?: { tags?: string[]; context?: Record<string, unknown> },
  ): Trace {
    if (this.config.verbose) {
      console.error("[EvolverOrchestrator] Ending session");
    }

    const trace = this.logger.endSession(finalAnswer, outcome, options);

    // Update principle usage statistics if principles were used
    if (this.currentContext && this.currentContext.principles.length > 0) {
      const wasSuccessful = outcome.status === "success";

      for (const principle of this.currentContext.principles) {
        try {
          this.storage.recordUsage(principle.id, trace.id, wasSuccessful);
        } catch (error) {
          if (this.config.verbose) {
            console.error(
              `[EvolverOrchestrator] Failed to record usage for principle ${principle.id}:`,
              error,
            );
          }
        }
      }
    }

    // Clear current context
    this.currentContext = null;

    return trace;
  }

  /**
   * Log a tool call (for trace collection)
   */
  logToolCall(
    tool: string,
    input: Record<string, unknown>,
    output: unknown,
    options?: { timestamp?: string; durationMs?: number },
  ): void {
    this.logger.logToolCall(tool, input, output, options);
  }

  /**
   * Log a reasoning step (for trace collection)
   */
  logThought(thought: string): void {
    this.logger.logThought(thought);
  }

  /**
   * Get the current session context
   */
  getCurrentContext(): SessionContext | null {
    return this.currentContext;
  }

  /**
   * Get the current session (from logger)
   */
  getCurrentSession(): LogSession | null {
    return this.logger.getCurrentSession();
  }

  /**
   * Get ExpBase storage (for direct queries)
   */
  getStorage(): ExpBaseStorage {
    return this.storage;
  }

  /**
   * Get trace logger (for direct logging)
   */
  getLogger(): TraceLogger {
    return this.logger;
  }

  /**
   * Clear the injected context file
   */
  clearContext(): void {
    if (fs.existsSync(this.config.contextFilePath)) {
      fs.unlinkSync(this.config.contextFilePath);
    }
    this.currentContext = null;
  }

  /**
   * Get orchestrator statistics
   */
  getStats(): {
    expbase: ReturnType<ExpBaseStorage["getStats"]>;
    context: SessionContext | null;
    contextFilePath: string;
  } {
    return {
      expbase: this.storage.getStats(),
      context: this.currentContext,
      contextFilePath: this.config.contextFilePath,
    };
  }

  /**
   * Close all connections
   */
  close(): void {
    this.storage.close();
    this.logger.close();
  }
}

