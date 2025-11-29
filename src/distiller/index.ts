/**
 * Distiller module exports
 *
 * Provides offline distillation functionality for extracting principles from traces
 */

export { Distiller, type DistillerConfig } from './distiller.js';
export {
  generateEmbedding,
  generateEmbeddings,
  cosineSimilarity,
  findSimilarPrinciples,
  textSimilarity,
  type EmbeddingConfig,
} from './embeddings.js';
export {
  DISTILLATION_SYSTEM_PROMPT,
  DISTILLATION_USER_PROMPT_TEMPLATE,
  BATCH_DISTILLATION_PROMPT,
  DEDUPLICATION_PROMPT,
  PRINCIPLE_REFINEMENT_PROMPT,
} from './prompts.js';

