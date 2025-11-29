/**
 * EvolveR Experience Base Type Definitions
 *
 * This module provides comprehensive TypeScript types for an EvolveR-style
 * experience base system that supports principle extraction, trace logging,
 * and retrieval-based learning.
 */

/**
 * Structured metadata triple representing a semantic relationship.
 * Used for organizing and querying principles and traces.
 *
 * @example
 * { subject: "user", relation: "prefers", object: "detailed_explanations" }
 */
export interface Triple {
  /** The subject entity in the relationship */
  subject: string;

  /** The type of relationship between subject and object */
  relation: string;

  /** The object entity in the relationship */
  object: string;
}

/**
 * Outcome of a trace execution with success status and numeric score.
 */
export interface TraceOutcome {
  /** Status of the trace execution */
  status: "success" | "failure" | "partial";

  /** Numeric score representing the quality of the outcome (0-1 typical range) */
  score: number;

  /** Optional human-readable explanation of the outcome */
  explanation?: string;
}

/**
 * A single tool invocation within a trace.
 * Records the complete context of a tool call for replay and analysis.
 */
export interface ToolCall {
  /** Name of the tool that was invoked */
  tool: string;

  /** Input parameters passed to the tool */
  input: Record<string, unknown>;

  /** Output returned by the tool (can be any JSON-serializable value) */
  output: unknown;

  /** ISO 8601 timestamp when the tool was called */
  timestamp: string;

  /** Optional duration of the tool call in milliseconds */
  duration_ms?: number;

  /** Optional error information if the tool call failed */
  error?: {
    message: string;
    code?: string;
    stack?: string;
  };
}

/**
 * A logged agent trajectory capturing a complete problem-solving episode.
 * Traces form the raw experience data from which principles are distilled.
 */
export interface Trace {
  /** Unique identifier for this trace */
  id: string;

  /** High-level summary of the task being performed */
  task_summary: string;

  /** Detailed description of the problem being solved */
  problem_description: string;

  /** Ordered sequence of tool invocations made during execution */
  tool_calls: ToolCall[];

  /** Agent's reasoning steps and observations during execution */
  intermediate_thoughts: string[];

  /** Final answer or result produced by the agent */
  final_answer: string;

  /** Outcome assessment of the trace */
  outcome: TraceOutcome;

  /** Total execution time in milliseconds */
  duration_ms: number;

  /** Model identifier used for this trace (e.g., "claude-sonnet-4-5-20250929") */
  model_used: string;

  /** Session identifier for grouping related traces */
  session_id: string;

  /** Optional structured metadata about the trace */
  triples?: Triple[];

  /** Optional tags for categorization */
  tags?: string[];

  /** ISO 8601 timestamp when the trace was created */
  created_at: string;

  /** Optional user or agent identifier */
  agent_id?: string;

  /** Optional environment or context information */
  context?: Record<string, unknown>;
}

/**
 * Reference to a trace that exemplifies a principle.
 * Used to ground principles in concrete examples.
 */
export interface TraceReference {
  /** ID of the referenced trace */
  trace_id: string;

  /** Optional explanation of why this trace is a good example */
  relevance_note?: string;

  /** Optional similarity score if retrieved by embedding search */
  similarity_score?: number;
}

/**
 * A learned strategic principle extracted from agent experiences.
 * Principles represent reusable knowledge that can guide future behavior.
 */
export interface Principle {
  /** Unique identifier for this principle */
  id: string;

  /** Natural language description of the principle */
  text: string;

  /** Structured metadata about the principle */
  triples: Triple[];

  /** Categorical tags for organizing and filtering principles */
  tags: string[];

  /** Traces that exemplify this principle */
  examples: TraceReference[];

  /** Number of times this principle has been used */
  use_count: number;

  /** Number of times using this principle led to success */
  success_count: number;

  /** Optional embedding vector for semantic search (typically 1024 or 1536 dimensions) */
  embedding?: number[];

  /** ISO 8601 timestamp when the principle was created */
  created_at: string;

  /** ISO 8601 timestamp when the principle was last updated */
  updated_at: string;

  /** Optional confidence score from distillation process */
  confidence?: number;

  /** Optional source information (e.g., "distilled", "manual", "imported") */
  source?: string;

  /** Optional version number for tracking principle evolution */
  version?: number;
}

/**
 * Calculates the Bayesian-adjusted score for a principle.
 * Uses the formula: s(p) = (success_count + 1) / (use_count + 2)
 *
 * The +1 and +2 priors prevent division by zero and provide conservative
 * estimates for principles with limited usage data.
 *
 * @param principle - The principle to score
 * @returns Score between 0 and 1, where higher is better
 *
 * @example
 * const principle = { success_count: 8, use_count: 10, ... };
 * const score = calculatePrincipleScore(principle); // Returns 0.75
 */
export function calculatePrincipleScore(
  principle: Pick<Principle, "success_count" | "use_count">,
): number {
  return (principle.success_count + 1) / (principle.use_count + 2);
}

/**
 * Represents a principle with its computed score.
 * Useful for ranking and filtering principles by effectiveness.
 */
export interface PrincipleScore {
  /** The principle being scored */
  principle: Principle;

  /** Computed score using the formula s(p) = (success_count + 1) / (use_count + 2) */
  score: number;

  /** Optional ranking position when sorted with other principles */
  rank?: number;
}

/**
 * Query parameters for searching the experience base.
 * Supports multiple search modalities: semantic, structured, and hybrid.
 */
export interface SearchQuery {
  /** Free-text query for semantic search */
  query_text?: string;

  /** Structured filters using triples */
  triples?: Triple[];

  /** Filter by tags (principles or traces matching ANY of these tags) */
  tags?: string[];

  /** Maximum number of results to return */
  limit?: number;

  /** Minimum similarity score threshold (0-1) for embedding-based search */
  min_similarity?: number;

  /** Minimum principle score threshold for filtering results */
  min_principle_score?: number;

  /** Search mode: principles, traces, or both */
  search_mode?: "principles" | "traces" | "both";

  /** Optional time range filter */
  time_range?: {
    start: string; // ISO 8601
    end: string; // ISO 8601
  };

  /** Optional outcome filter for traces */
  outcome_filter?: TraceOutcome["status"] | TraceOutcome["status"][];

  /** Optional model filter for traces */
  model_filter?: string | string[];

  /** Whether to include embeddings in results (can be large) */
  include_embeddings?: boolean;
}

/**
 * Result from a search_experience operation.
 */
export interface SearchResult {
  /** Type of the result */
  type: "principle" | "trace";

  /** The principle or trace that matched */
  item: Principle | Trace;

  /** Similarity score if semantic search was used */
  similarity_score?: number;

  /** Explanation of why this result was returned */
  match_reason?: string;
}

/**
 * Complete response from a search_experience query.
 */
export interface SearchResponse {
  /** Results matching the query */
  results: SearchResult[];

  /** Total number of matches (before limit applied) */
  total_count: number;

  /** Query execution time in milliseconds */
  query_time_ms: number;

  /** Optional debug information about the search */
  debug_info?: Record<string, unknown>;
}

/**
 * Configuration for the distillation process.
 * Controls how principles are extracted from traces.
 */
export interface DistillationConfig {
  /** Minimum number of similar traces required to create a principle */
  min_trace_cluster_size?: number;

  /** Similarity threshold for grouping traces (0-1) */
  similarity_threshold?: number;

  /** Maximum number of example traces to attach to a principle */
  max_examples_per_principle?: number;

  /** Whether to merge similar existing principles */
  merge_similar_principles?: boolean;

  /** Minimum outcome score to consider a trace for distillation */
  min_outcome_score?: number;

  /** Model to use for distillation (e.g., "claude-sonnet-4-5-20250929") */
  distillation_model?: string;

  /** Custom prompt template for principle extraction */
  prompt_template?: string;
}

/**
 * Output from an offline distillation process.
 * Summarizes the principles learned from a batch of traces.
 */
export interface DistillationResult {
  /** Newly created principles */
  new_principles: Principle[];

  /** Existing principles that were updated */
  updated_principles: Principle[];

  /** Principles that were merged or deprecated */
  deprecated_principles?: string[]; // IDs

  /** Number of traces processed */
  traces_processed: number;

  /** Number of traces that contributed to principles */
  traces_used: number;

  /** Execution time for distillation in milliseconds */
  duration_ms: number;

  /** ISO 8601 timestamp when distillation was performed */
  timestamp: string;

  /** Configuration used for this distillation run */
  config: DistillationConfig;

  /** Optional statistics about the distillation process */
  statistics?: {
    avg_principle_quality?: number;
    trace_coverage?: number; // Percentage of traces that contributed
    cluster_count?: number;
    merge_count?: number;
  };

  /** Optional errors or warnings encountered during distillation */
  issues?: Array<{
    severity: "error" | "warning" | "info";
    message: string;
    trace_id?: string;
    principle_id?: string;
  }>;
}

/**
 * Statistics about the experience base.
 * Useful for monitoring and understanding the system's knowledge.
 */
export interface ExperienceBaseStats {
  /** Total number of principles */
  principle_count: number;

  /** Total number of traces */
  trace_count: number;

  /** Average principle score across all principles */
  avg_principle_score: number;

  /** Distribution of principle scores */
  score_distribution?: {
    min: number;
    max: number;
    median: number;
    p25: number;
    p75: number;
    p90: number;
    p99: number;
  };

  /** Most common tags */
  top_tags?: Array<{ tag: string; count: number }>;

  /** Most used principles */
  top_principles?: PrincipleScore[];

  /** Success rate of traces */
  trace_success_rate?: number;

  /** Average trace duration */
  avg_trace_duration_ms?: number;

  /** Time range of data */
  time_range?: {
    earliest: string; // ISO 8601
    latest: string; // ISO 8601
  };
}

/**
 * Options for updating principle usage statistics.
 */
export interface PrincipleUsageUpdate {
  /** ID of the principle that was used */
  principle_id: string;

  /** Whether using the principle led to success */
  was_successful: boolean;

  /** Optional trace ID where the principle was used */
  trace_id?: string;

  /** ISO 8601 timestamp of the usage */
  timestamp?: string;
}

/**
 * Batch update for multiple principles.
 * Useful for efficiently updating statistics after a session.
 */
export interface BatchPrincipleUpdate {
  /** Updates to apply */
  updates: PrincipleUsageUpdate[];

  /** Optional session ID for grouping updates */
  session_id?: string;
}

/**
 * Type guard to check if a search result is a principle.
 */
export function isPrincipleResult(
  result: SearchResult,
): result is SearchResult & { item: Principle } {
  return result.type === "principle";
}

/**
 * Type guard to check if a search result is a trace.
 */
export function isTraceResult(
  result: SearchResult,
): result is SearchResult & { item: Trace } {
  return result.type === "trace";
}

/**
 * Helper type for creating a new principle (omits computed/generated fields).
 */
export type NewPrinciple = Omit<
  Principle,
  "id" | "created_at" | "updated_at" | "use_count" | "success_count"
> & {
  id?: string;
  use_count?: number;
  success_count?: number;
};

/**
 * Helper type for creating a new trace (omits computed/generated fields).
 */
export type NewTrace = Omit<Trace, "id" | "created_at"> & {
  id?: string;
};

/**
 * Helper type for partial updates to principles.
 */
export type PrincipleUpdate = Partial<Omit<Principle, "id" | "created_at">> & {
  id: string;
};

/**
 * Helper type for partial updates to traces.
 */
export type TraceUpdate = Partial<Omit<Trace, "id" | "created_at">> & {
  id: string;
};

