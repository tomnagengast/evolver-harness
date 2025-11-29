/**
 * EvolveR Harness - Experience-Augmented Wrapper for Claude Code
 *
 * Main exports for the evolver-harness package.
 */

// Types
export * from './types.js';

// Storage
export { ExpBaseStorage } from './storage/expbase.js';

// Logging
export { TraceLogger, SessionStateManager, type LogSession } from './logger/trace-logger.js';

// Distillation
export { Distiller, type DistillerConfig } from './distiller/distiller.js';
export {
  generateEmbedding,
  cosineSimilarity,
  findSimilarPrinciples,
  type EmbeddingConfig,
} from './distiller/embeddings.js';

// Retrieval
export { ExperienceRetriever } from './retriever/retriever.js';

// Orchestration
export {
  EvolverOrchestrator,
  type OrchestratorConfig,
  type SessionContext,
  type SearchExperienceResult,
} from './orchestrator/orchestrator.js';

export {
  EVOLVER_SYSTEM_PROMPT,
  EVOLVER_TOOL_SCHEMAS,
  SEARCH_EXPERIENCE_TOOL_SCHEMA,
  LOG_TRAJECTORY_TOOL_SCHEMA,
  DEFAULT_SEARCH_CONFIG,
  formatPrincipleForDisplay,
  formatTraceForDisplay,
} from './orchestrator/contract.js';

