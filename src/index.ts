/**
 * EvolveR Harness - Experience-Augmented Wrapper for Claude Code
 *
 * Main exports for the evolver-harness package.
 */

// Distillation
export { Distiller, type DistillerConfig } from "./distiller/distiller.js";
export {
  cosineSimilarity,
  type EmbeddingConfig,
  findSimilarPrinciples,
  generateEmbedding,
} from "./distiller/embeddings.js";

// Logging
export {
  type LogSession,
  SessionStateManager,
  TraceLogger,
} from "./logger/trace-logger.js";
export {
  DEFAULT_SEARCH_CONFIG,
  EVOLVER_SYSTEM_PROMPT,
  EVOLVER_TOOL_SCHEMAS,
  formatPrincipleForDisplay,
  formatTraceForDisplay,
  LOG_TRAJECTORY_TOOL_SCHEMA,
  SEARCH_EXPERIENCE_TOOL_SCHEMA,
} from "./orchestrator/contract.js";
// Orchestration
export {
  EvolverOrchestrator,
  type OrchestratorConfig,
  type SearchExperienceResult,
  type SessionContext,
} from "./orchestrator/orchestrator.js";

// Retrieval
export { ExperienceRetriever } from "./retriever/retriever.js";
// Storage
export { ExpBaseStorage } from "./storage/expbase.js";
// Types
export * from "./types.js";
