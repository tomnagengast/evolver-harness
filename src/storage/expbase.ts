/**
 * SQLite-based ExpBase Storage Layer
 *
 * Provides persistent storage for principles, traces, and usage analytics
 * using better-sqlite3 for synchronous SQLite operations.
 */

import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import {
  calculatePrincipleScore,
  type ExperienceBaseStats,
  type NewPrinciple,
  type NewTrace,
  type Principle,
  type PrincipleScore,
  type SearchQuery,
  type Trace,
} from "../types";

/**
 * Represents a principle usage event for analytics and scoring
 */
export interface PrincipleUsageEvent {
  id: string;
  principle_id: string;
  trace_id?: string;
  was_successful: boolean;
  created_at: string;
}

/**
 * Update data for modifying an existing principle
 */
export type PrincipleUpdate = Partial<Omit<Principle, "id" | "created_at">>;

/**
 * Configuration options for the ExpBase storage layer
 */
export interface ExpBaseConfig {
  /** Path to the SQLite database file */
  dbPath: string;

  /** Enable Write-Ahead Logging for better concurrency (default: true) */
  enableWAL?: boolean;

  /** Enable verbose logging (default: false) */
  verbose?: boolean;
}

/**
 * SQLite-based storage layer for the EvolveR experience base.
 * Manages principles, traces, and usage analytics with efficient querying and scoring.
 */
export class ExpBaseStorage {
  private db: Database.Database;
  private config: ExpBaseConfig;

  constructor(config: ExpBaseConfig) {
    this.config = {
      enableWAL: true,
      verbose: false,
      ...config,
    };

    try {
      this.db = new Database(this.config.dbPath, {
        verbose: this.config.verbose ? console.log : undefined,
      });

      // Enable WAL mode for better concurrency
      if (this.config.enableWAL) {
        this.db.pragma("journal_mode = WAL");
      }

      // Optimize for performance
      this.db.pragma("synchronous = NORMAL");
      this.db.pragma("foreign_keys = ON");

      this.initDatabase();
    } catch (error) {
      throw new Error(
        `Failed to initialize ExpBase database: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Initialize database schema with tables and indexes
   */
  initDatabase(): void {
    try {
      // Principles table
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS principles (
          id TEXT PRIMARY KEY,
          text TEXT NOT NULL,
          triples TEXT NOT NULL, -- JSON array
          tags TEXT NOT NULL, -- JSON array
          examples TEXT NOT NULL, -- JSON array
          use_count INTEGER NOT NULL DEFAULT 0,
          success_count INTEGER NOT NULL DEFAULT 0,
          embedding TEXT, -- JSON array of numbers
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          confidence REAL,
          source TEXT,
          version INTEGER DEFAULT 1
        )
      `);

      // Traces table
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS traces (
          id TEXT PRIMARY KEY,
          task_summary TEXT NOT NULL,
          problem_description TEXT NOT NULL,
          tool_calls TEXT NOT NULL, -- JSON array
          intermediate_thoughts TEXT NOT NULL, -- JSON array
          final_answer TEXT NOT NULL,
          outcome TEXT NOT NULL, -- JSON object
          duration_ms INTEGER NOT NULL,
          model_used TEXT NOT NULL,
          session_id TEXT NOT NULL,
          triples TEXT, -- JSON array
          tags TEXT, -- JSON array
          created_at TEXT NOT NULL,
          agent_id TEXT,
          context TEXT -- JSON object
        )
      `);

      // Principle usage tracking table
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS principle_usage (
          id TEXT PRIMARY KEY,
          principle_id TEXT NOT NULL,
          trace_id TEXT,
          was_successful INTEGER NOT NULL, -- 0 or 1 (SQLite boolean)
          created_at TEXT NOT NULL,
          FOREIGN KEY (principle_id) REFERENCES principles(id) ON DELETE CASCADE,
          FOREIGN KEY (trace_id) REFERENCES traces(id) ON DELETE SET NULL
        )
      `);

      // Create indexes for efficient queries
      this.db.exec(`
        CREATE INDEX IF NOT EXISTS idx_principles_use_count
        ON principles(use_count);

        CREATE INDEX IF NOT EXISTS idx_principles_success_count
        ON principles(success_count);

        CREATE INDEX IF NOT EXISTS idx_principles_created_at
        ON principles(created_at);

        CREATE INDEX IF NOT EXISTS idx_principles_updated_at
        ON principles(updated_at);

        CREATE INDEX IF NOT EXISTS idx_traces_session_id
        ON traces(session_id);

        CREATE INDEX IF NOT EXISTS idx_traces_model_used
        ON traces(model_used);

        CREATE INDEX IF NOT EXISTS idx_traces_created_at
        ON traces(created_at);

        CREATE INDEX IF NOT EXISTS idx_principle_usage_principle_id
        ON principle_usage(principle_id);

        CREATE INDEX IF NOT EXISTS idx_principle_usage_trace_id
        ON principle_usage(trace_id);

        CREATE INDEX IF NOT EXISTS idx_principle_usage_created_at
        ON principle_usage(created_at);
      `);
    } catch (error) {
      throw new Error(
        `Failed to initialize database schema: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Add a new principle to the database
   */
  addPrinciple(principle: NewPrinciple): Principle {
    try {
      const now = new Date().toISOString();
      const id = principle.id || randomUUID();

      const newPrinciple: Principle = {
        id,
        text: principle.text,
        triples: principle.triples,
        tags: principle.tags,
        examples: principle.examples,
        use_count: principle.use_count ?? 0,
        success_count: principle.success_count ?? 0,
        embedding: principle.embedding,
        created_at: now,
        updated_at: now,
        confidence: principle.confidence,
        source: principle.source,
        version: principle.version ?? 1,
      };

      const stmt = this.db.prepare(`
        INSERT INTO principles (
          id, text, triples, tags, examples, use_count, success_count,
          embedding, created_at, updated_at, confidence, source, version
        ) VALUES (
          @id, @text, @triples, @tags, @examples, @use_count, @success_count,
          @embedding, @created_at, @updated_at, @confidence, @source, @version
        )
      `);

      stmt.run({
        id: newPrinciple.id,
        text: newPrinciple.text,
        triples: JSON.stringify(newPrinciple.triples),
        tags: JSON.stringify(newPrinciple.tags),
        examples: JSON.stringify(newPrinciple.examples),
        use_count: newPrinciple.use_count,
        success_count: newPrinciple.success_count,
        embedding: newPrinciple.embedding
          ? JSON.stringify(newPrinciple.embedding)
          : null,
        created_at: newPrinciple.created_at,
        updated_at: newPrinciple.updated_at,
        confidence: newPrinciple.confidence ?? null,
        source: newPrinciple.source ?? null,
        version: newPrinciple.version,
      });

      return newPrinciple;
    } catch (error) {
      throw new Error(
        `Failed to add principle: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Update an existing principle
   */
  updatePrinciple(id: string, updates: PrincipleUpdate): Principle {
    try {
      const existing = this.getPrinciple(id);
      if (!existing) {
        throw new Error(`Principle with id ${id} not found`);
      }

      const updated: Principle = {
        ...existing,
        ...updates,
        id, // Ensure id doesn't change
        created_at: existing.created_at, // Preserve creation time
        updated_at: new Date().toISOString(),
      };

      const stmt = this.db.prepare(`
        UPDATE principles SET
          text = @text,
          triples = @triples,
          tags = @tags,
          examples = @examples,
          use_count = @use_count,
          success_count = @success_count,
          embedding = @embedding,
          updated_at = @updated_at,
          confidence = @confidence,
          source = @source,
          version = @version
        WHERE id = @id
      `);

      stmt.run({
        id: updated.id,
        text: updated.text,
        triples: JSON.stringify(updated.triples),
        tags: JSON.stringify(updated.tags),
        examples: JSON.stringify(updated.examples),
        use_count: updated.use_count,
        success_count: updated.success_count,
        embedding: updated.embedding ? JSON.stringify(updated.embedding) : null,
        updated_at: updated.updated_at,
        confidence: updated.confidence ?? null,
        source: updated.source ?? null,
        version: updated.version ?? 1,
      });

      return updated;
    } catch (error) {
      throw new Error(
        `Failed to update principle: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Get a principle by ID
   */
  getPrinciple(id: string): Principle | null {
    try {
      const stmt = this.db.prepare("SELECT * FROM principles WHERE id = ?");
      const row = stmt.get(id) as any;

      if (!row) {
        return null;
      }

      return this.deserializePrinciple(row);
    } catch (error) {
      throw new Error(
        `Failed to get principle: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Get all principles
   */
  getAllPrinciples(): Principle[] {
    try {
      const stmt = this.db.prepare(
        "SELECT * FROM principles ORDER BY updated_at DESC",
      );
      const rows = stmt.all() as any[];
      return rows.map((row) => this.deserializePrinciple(row));
    } catch (error) {
      throw new Error(
        `Failed to get all principles: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Delete a principle by ID
   */
  deletePrinciple(id: string): boolean {
    try {
      const stmt = this.db.prepare("DELETE FROM principles WHERE id = ?");
      const result = stmt.run(id);
      return result.changes > 0;
    } catch (error) {
      throw new Error(
        `Failed to delete principle: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Add a new trace to the database
   */
  addTrace(trace: NewTrace): Trace {
    try {
      const now = new Date().toISOString();
      const id = trace.id || randomUUID();

      const newTrace: Trace = {
        id,
        task_summary: trace.task_summary,
        problem_description: trace.problem_description,
        tool_calls: trace.tool_calls,
        intermediate_thoughts: trace.intermediate_thoughts,
        final_answer: trace.final_answer,
        outcome: trace.outcome,
        duration_ms: trace.duration_ms,
        model_used: trace.model_used,
        session_id: trace.session_id,
        triples: trace.triples,
        tags: trace.tags,
        created_at: now,
        agent_id: trace.agent_id,
        context: trace.context,
      };

      const stmt = this.db.prepare(`
        INSERT INTO traces (
          id, task_summary, problem_description, tool_calls, intermediate_thoughts,
          final_answer, outcome, duration_ms, model_used, session_id, triples,
          tags, created_at, agent_id, context
        ) VALUES (
          @id, @task_summary, @problem_description, @tool_calls, @intermediate_thoughts,
          @final_answer, @outcome, @duration_ms, @model_used, @session_id, @triples,
          @tags, @created_at, @agent_id, @context
        )
      `);

      stmt.run({
        id: newTrace.id,
        task_summary: newTrace.task_summary,
        problem_description: newTrace.problem_description,
        tool_calls: JSON.stringify(newTrace.tool_calls),
        intermediate_thoughts: JSON.stringify(newTrace.intermediate_thoughts),
        final_answer: newTrace.final_answer,
        outcome: JSON.stringify(newTrace.outcome),
        duration_ms: newTrace.duration_ms,
        model_used: newTrace.model_used,
        session_id: newTrace.session_id,
        triples: newTrace.triples ? JSON.stringify(newTrace.triples) : null,
        tags: newTrace.tags ? JSON.stringify(newTrace.tags) : null,
        created_at: newTrace.created_at,
        agent_id: newTrace.agent_id ?? null,
        context: newTrace.context ? JSON.stringify(newTrace.context) : null,
      });

      return newTrace;
    } catch (error) {
      throw new Error(
        `Failed to add trace: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Get a trace by ID
   */
  getTrace(id: string): Trace | null {
    try {
      const stmt = this.db.prepare("SELECT * FROM traces WHERE id = ?");
      const row = stmt.get(id) as any;

      if (!row) {
        return null;
      }

      return this.deserializeTrace(row);
    } catch (error) {
      throw new Error(
        `Failed to get trace: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Get all traces
   */
  getAllTraces(): Trace[] {
    try {
      const stmt = this.db.prepare(
        "SELECT * FROM traces ORDER BY created_at DESC",
      );
      const rows = stmt.all() as any[];
      return rows.map((row) => this.deserializeTrace(row));
    } catch (error) {
      throw new Error(
        `Failed to get all traces: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Get traces by session ID
   */
  getTracesBySession(sessionId: string): Trace[] {
    try {
      const stmt = this.db.prepare(
        "SELECT * FROM traces WHERE session_id = ? ORDER BY created_at ASC",
      );
      const rows = stmt.all(sessionId) as any[];
      return rows.map((row) => this.deserializeTrace(row));
    } catch (error) {
      throw new Error(
        `Failed to get traces by session: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Search principles with filtering by tags and triples
   */
  searchPrinciples(query: SearchQuery): Principle[] {
    try {
      let sql = "SELECT * FROM principles WHERE 1=1";
      const params: any[] = [];

      // Filter by tags (ANY match)
      if (query.tags && query.tags.length > 0) {
        const tagConditions = query.tags.map(() => "tags LIKE ?").join(" OR ");
        sql += ` AND (${tagConditions})`;
        query.tags.forEach((tag) => params.push(`%"${tag}"%`));
      }

      // Filter by triples
      if (query.triples && query.triples.length > 0) {
        query.triples.forEach((triple) => {
          sql += " AND triples LIKE ?";
          params.push(`%${JSON.stringify(triple).slice(1, -1)}%`);
        });
      }

      // Filter by time range
      if (query.time_range) {
        sql += " AND created_at >= ? AND created_at <= ?";
        params.push(query.time_range.start, query.time_range.end);
      }

      // Filter by minimum principle score
      if (query.min_principle_score !== undefined) {
        // This is approximate filtering - exact filtering happens after retrieval
        sql += " AND (success_count + 1.0) / (use_count + 2.0) >= ?";
        params.push(query.min_principle_score);
      }

      sql += " ORDER BY updated_at DESC";

      // Apply limit
      if (query.limit) {
        sql += " LIMIT ?";
        params.push(query.limit);
      }

      const stmt = this.db.prepare(sql);
      const rows = stmt.all(...params) as any[];
      let principles = rows.map((row) => this.deserializePrinciple(row));

      // Remove embeddings if not requested
      if (!query.include_embeddings) {
        principles = principles.map((p) => ({ ...p, embedding: undefined }));
      }

      return principles;
    } catch (error) {
      throw new Error(
        `Failed to search principles: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Search traces with filtering
   */
  searchTraces(query: SearchQuery): Trace[] {
    try {
      let sql = "SELECT * FROM traces WHERE 1=1";
      const params: any[] = [];

      // Filter by tags (ANY match)
      if (query.tags && query.tags.length > 0) {
        const tagConditions = query.tags.map(() => "tags LIKE ?").join(" OR ");
        sql += ` AND (${tagConditions})`;
        query.tags.forEach((tag) => params.push(`%"${tag}"%`));
      }

      // Filter by outcome status
      if (query.outcome_filter) {
        const statuses = Array.isArray(query.outcome_filter)
          ? query.outcome_filter
          : [query.outcome_filter];
        const statusConditions = statuses
          .map(() => "outcome LIKE ?")
          .join(" OR ");
        sql += ` AND (${statusConditions})`;
        statuses.forEach((status) => params.push(`%"status":"${status}"%`));
      }

      // Filter by model
      if (query.model_filter) {
        const models = Array.isArray(query.model_filter)
          ? query.model_filter
          : [query.model_filter];
        const modelConditions = models.map(() => "model_used = ?").join(" OR ");
        sql += ` AND (${modelConditions})`;
        models.forEach((model) => params.push(model));
      }

      // Filter by time range
      if (query.time_range) {
        sql += " AND created_at >= ? AND created_at <= ?";
        params.push(query.time_range.start, query.time_range.end);
      }

      sql += " ORDER BY created_at DESC";

      // Apply limit
      if (query.limit) {
        sql += " LIMIT ?";
        params.push(query.limit);
      }

      const stmt = this.db.prepare(sql);
      const rows = stmt.all(...params) as any[];
      return rows.map((row) => this.deserializeTrace(row));
    } catch (error) {
      throw new Error(
        `Failed to search traces: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Record a principle usage event
   */
  recordUsage(
    principleId: string,
    traceId: string | undefined,
    wasSuccessful: boolean,
  ): PrincipleUsageEvent {
    const transaction = this.db.transaction(() => {
      try {
        // Create usage event
        const event: PrincipleUsageEvent = {
          id: randomUUID(),
          principle_id: principleId,
          trace_id: traceId,
          was_successful: wasSuccessful,
          created_at: new Date().toISOString(),
        };

        const usageStmt = this.db.prepare(`
          INSERT INTO principle_usage (id, principle_id, trace_id, was_successful, created_at)
          VALUES (@id, @principle_id, @trace_id, @was_successful, @created_at)
        `);

        usageStmt.run({
          id: event.id,
          principle_id: event.principle_id,
          trace_id: event.trace_id ?? null,
          was_successful: wasSuccessful ? 1 : 0,
          created_at: event.created_at,
        });

        // Update principle counters
        const updateStmt = this.db.prepare(`
          UPDATE principles
          SET use_count = use_count + 1,
              success_count = success_count + ?,
              updated_at = ?
          WHERE id = ?
        `);

        updateStmt.run(wasSuccessful ? 1 : 0, event.created_at, principleId);

        return event;
      } catch (error) {
        throw new Error(
          `Failed to record usage: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    });

    return transaction();
  }

  /**
   * Calculate the Bayesian score for a principle: s(p) = (success + 1) / (use + 2)
   */
  getPrincipleScore(principleId: string): number {
    try {
      const principle = this.getPrinciple(principleId);
      if (!principle) {
        throw new Error(`Principle with id ${principleId} not found`);
      }

      return calculatePrincipleScore(principle);
    } catch (error) {
      throw new Error(
        `Failed to get principle score: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Get all principles with their scores, sorted by score
   */
  getPrincipleScores(): PrincipleScore[] {
    try {
      const principles = this.getAllPrinciples();
      const scores: PrincipleScore[] = principles.map((principle) => ({
        principle,
        score: calculatePrincipleScore(principle),
      }));

      // Sort by score descending
      scores.sort((a, b) => b.score - a.score);

      // Add rank
      scores.forEach((item, index) => {
        item.rank = index + 1;
      });

      return scores;
    } catch (error) {
      throw new Error(
        `Failed to get principle scores: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Prune principles with scores below the threshold
   */
  pruneLowScorePrinciples(threshold: number, minUsageCount = 10): string[] {
    try {
      const principles = this.getAllPrinciples();
      const prunedIds: string[] = [];

      for (const principle of principles) {
        // Only prune if the principle has been used enough times
        if (principle.use_count >= minUsageCount) {
          const score = calculatePrincipleScore(principle);
          if (score < threshold) {
            this.deletePrinciple(principle.id);
            prunedIds.push(principle.id);
          }
        }
      }

      return prunedIds;
    } catch (error) {
      throw new Error(
        `Failed to prune principles: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Get comprehensive statistics about the experience base
   */
  getStats(): ExperienceBaseStats {
    try {
      // Count principles and traces
      const principleCountStmt = this.db.prepare(
        "SELECT COUNT(*) as count FROM principles",
      );
      const traceCountStmt = this.db.prepare(
        "SELECT COUNT(*) as count FROM traces",
      );

      const principleCount = (principleCountStmt.get() as any).count;
      const traceCount = (traceCountStmt.get() as any).count;

      // Get all principles for score calculation
      const principles = this.getAllPrinciples();
      const scores = principles.map((p) => calculatePrincipleScore(p));

      // Calculate average score
      const avgScore =
        scores.length > 0
          ? scores.reduce((sum, s) => sum + s, 0) / scores.length
          : 0;

      // Calculate score distribution
      let scoreDistribution;
      if (scores.length > 0) {
        const sortedScores = [...scores].sort((a, b) => a - b);
        const percentile = (p: number) =>
          sortedScores[Math.floor((p / 100) * sortedScores.length)];

        scoreDistribution = {
          min: sortedScores[0],
          max: sortedScores[sortedScores.length - 1],
          median: percentile(50),
          p25: percentile(25),
          p75: percentile(75),
          p90: percentile(90),
          p99: percentile(99),
        };
      }

      // Get top tags
      const tagCounts = new Map<string, number>();
      for (const principle of principles) {
        for (const tag of principle.tags) {
          tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
        }
      }

      const topTags = Array.from(tagCounts.entries())
        .map(([tag, count]) => ({ tag, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);

      // Get top principles
      const principleScores = this.getPrincipleScores().slice(0, 10);

      // Calculate trace statistics
      const traces = this.getAllTraces();
      let traceSuccessRate;
      let avgTraceDurationMs;

      if (traces.length > 0) {
        const successCount = traces.filter(
          (t) => t.outcome.status === "success",
        ).length;
        traceSuccessRate = successCount / traces.length;

        const totalDuration = traces.reduce((sum, t) => sum + t.duration_ms, 0);
        avgTraceDurationMs = totalDuration / traces.length;
      }

      // Get time range
      let timeRange;
      const allDates = [
        ...principles.map((p) => p.created_at),
        ...traces.map((t) => t.created_at),
      ].sort();

      if (allDates.length > 0) {
        timeRange = {
          earliest: allDates[0],
          latest: allDates[allDates.length - 1],
        };
      }

      return {
        principle_count: principleCount,
        trace_count: traceCount,
        avg_principle_score: avgScore,
        score_distribution: scoreDistribution,
        top_tags: topTags.length > 0 ? topTags : undefined,
        top_principles:
          principleScores.length > 0 ? principleScores : undefined,
        trace_success_rate: traceSuccessRate,
        avg_trace_duration_ms: avgTraceDurationMs,
        time_range: timeRange,
      };
    } catch (error) {
      throw new Error(
        `Failed to get stats: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Get usage history for a specific principle
   */
  getPrincipleUsageHistory(principleId: string): PrincipleUsageEvent[] {
    try {
      const stmt = this.db.prepare(
        "SELECT * FROM principle_usage WHERE principle_id = ? ORDER BY created_at DESC",
      );
      const rows = stmt.all(principleId) as any[];

      return rows.map((row) => ({
        id: row.id,
        principle_id: row.principle_id,
        trace_id: row.trace_id,
        was_successful: row.was_successful === 1,
        created_at: row.created_at,
      }));
    } catch (error) {
      throw new Error(
        `Failed to get usage history: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Close the database connection
   */
  close(): void {
    try {
      this.db.close();
    } catch (error) {
      throw new Error(
        `Failed to close database: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Execute a backup of the database
   */
  backup(destinationPath: string): void {
    try {
      this.db.backup(destinationPath);
    } catch (error) {
      throw new Error(
        `Failed to backup database: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Vacuum the database to reclaim space and optimize
   */
  vacuum(): void {
    try {
      this.db.exec("VACUUM");
    } catch (error) {
      throw new Error(
        `Failed to vacuum database: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  // Private helper methods

  private deserializePrinciple(row: any): Principle {
    return {
      id: row.id,
      text: row.text,
      triples: JSON.parse(row.triples),
      tags: JSON.parse(row.tags),
      examples: JSON.parse(row.examples),
      use_count: row.use_count,
      success_count: row.success_count,
      embedding: row.embedding ? JSON.parse(row.embedding) : undefined,
      created_at: row.created_at,
      updated_at: row.updated_at,
      confidence: row.confidence ?? undefined,
      source: row.source ?? undefined,
      version: row.version ?? 1,
    };
  }

  private deserializeTrace(row: any): Trace {
    return {
      id: row.id,
      task_summary: row.task_summary,
      problem_description: row.problem_description,
      tool_calls: JSON.parse(row.tool_calls),
      intermediate_thoughts: JSON.parse(row.intermediate_thoughts),
      final_answer: row.final_answer,
      outcome: JSON.parse(row.outcome),
      duration_ms: row.duration_ms,
      model_used: row.model_used,
      session_id: row.session_id,
      triples: row.triples ? JSON.parse(row.triples) : undefined,
      tags: row.tags ? JSON.parse(row.tags) : undefined,
      created_at: row.created_at,
      agent_id: row.agent_id ?? undefined,
      context: row.context ? JSON.parse(row.context) : undefined,
    };
  }
}

