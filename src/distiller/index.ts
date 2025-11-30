/**
 * Distiller module exports
 *
 * Provides offline distillation functionality for extracting principles from traces
 */

export { Distiller, type DistillerConfig } from "./distiller.js";
export {
  cosineSimilarity,
  type EmbeddingConfig,
  findSimilarPrinciples,
  generateEmbedding,
  generateEmbeddings,
  textSimilarity,
} from "./embeddings.js";
export {
  BATCH_DISTILLATION_PROMPT,
  DEDUPLICATION_PROMPT,
  DISTILLATION_SYSTEM_PROMPT,
  DISTILLATION_USER_PROMPT_TEMPLATE,
  PRINCIPLE_REFINEMENT_PROMPT,
} from "./prompts.js";
