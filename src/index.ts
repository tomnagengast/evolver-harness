/**
 * EvolveR Harness - Experience-Augmented Wrapper for Claude Code
 *
 * Main exports for the evolver-harness package.
 *
 * Note: The orchestration layer has been replaced by a hooks-based approach.
 * See hooks/ directory for the current implementation.
 */

// Distillation (offline principle extraction)
export { Distiller, type DistillerConfig } from "./distiller/distiller.js";
export {
  cosineSimilarity,
  type EmbeddingConfig,
  findSimilarPrinciples,
  generateEmbedding,
} from "./distiller/embeddings.js";

// Storage (core - used by hooks)
export { ExpBaseStorage } from "./storage/expbase.js";

// Types (core - used by all modules)
export * from "./types.js";
