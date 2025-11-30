/**
 * Embedding generation and similarity functions for principle deduplication
 *
 * Supports OpenAI embeddings with fallback to simple text-based similarity
 */

import type { Principle } from "../types.js";

/**
 * Configuration for embedding generation
 */
export interface EmbeddingConfig {
  /** Provider: 'openai' or 'mock' (for testing) */
  provider?: "openai" | "mock";

  /** OpenAI API key (if using OpenAI) */
  apiKey?: string;

  /** OpenAI model to use (default: text-embedding-3-small) */
  model?: string;

  /** OpenAI API base URL (optional, for proxies or custom endpoints) */
  apiBaseUrl?: string;
}

/**
 * Generate an embedding vector for the given text
 */
export async function generateEmbedding(
  text: string,
  config: EmbeddingConfig = {},
): Promise<number[]> {
  const provider = config.provider || "openai";

  if (provider === "mock") {
    // Simple mock embedding for testing - just use character code distribution
    const words = text.toLowerCase().split(/\s+/);
    const vector = new Array(384).fill(0);

    words.forEach((word, idx) => {
      for (let i = 0; i < word.length; i++) {
        const pos = (word.charCodeAt(i) + idx) % vector.length;
        vector[pos] += 1 / (word.length + 1);
      }
    });

    // Normalize
    const magnitude = Math.sqrt(
      vector.reduce((sum, val) => sum + val * val, 0),
    );
    return vector.map((v) => v / (magnitude || 1));
  }

  if (provider === "openai") {
    const apiKey = config.apiKey || process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error(
        "OpenAI API key not provided. Set OPENAI_API_KEY or pass apiKey in config",
      );
    }

    const model = config.model || "text-embedding-3-small";
    const baseUrl = config.apiBaseUrl || "https://api.openai.com/v1";

    try {
      const response = await fetch(`${baseUrl}/embeddings`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          input: text,
          model,
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`OpenAI API error: ${response.status} ${error}`);
      }

      const data = (await response.json()) as {
        data: Array<{ embedding: number[] }>;
      };
      return data.data[0].embedding;
    } catch (error) {
      throw new Error(
        `Failed to generate embedding: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  throw new Error(`Unsupported embedding provider: ${provider}`);
}

/**
 * Calculate cosine similarity between two embedding vectors
 * Returns a value between -1 and 1, where 1 is identical
 */
export function cosineSimilarity(vecA: number[], vecB: number[]): number {
  if (vecA.length !== vecB.length) {
    throw new Error(
      `Vector dimensions must match: ${vecA.length} vs ${vecB.length}`,
    );
  }

  let dotProduct = 0;
  let magA = 0;
  let magB = 0;

  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    magA += vecA[i] * vecA[i];
    magB += vecB[i] * vecB[i];
  }

  magA = Math.sqrt(magA);
  magB = Math.sqrt(magB);

  if (magA === 0 || magB === 0) {
    return 0;
  }

  return dotProduct / (magA * magB);
}

/**
 * Find principles similar to the given embedding
 */
export function findSimilarPrinciples(
  targetEmbedding: number[],
  allPrinciples: Principle[],
  threshold = 0.85,
): Array<{ principle: Principle; similarity: number }> {
  const results: Array<{ principle: Principle; similarity: number }> = [];

  for (const principle of allPrinciples) {
    if (!principle.embedding || principle.embedding.length === 0) {
      continue;
    }

    try {
      const similarity = cosineSimilarity(targetEmbedding, principle.embedding);
      if (similarity >= threshold) {
        results.push({ principle, similarity });
      }
    } catch (error) {
      // Skip principles with incompatible embedding dimensions
      console.warn(
        `Skipping principle ${principle.id}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  // Sort by similarity descending
  results.sort((a, b) => b.similarity - a.similarity);

  return results;
}

/**
 * Generate embeddings for a batch of texts
 * Includes basic rate limiting to avoid API throttling
 */
export async function generateEmbeddings(
  texts: string[],
  config: EmbeddingConfig = {},
  delayMs = 0,
): Promise<number[][]> {
  const embeddings: number[][] = [];

  for (let i = 0; i < texts.length; i++) {
    if (i > 0 && delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    const embedding = await generateEmbedding(texts[i], config);
    embeddings.push(embedding);
  }

  return embeddings;
}

/**
 * Simple text-based similarity fallback (Jaccard similarity on word sets)
 * Used when embeddings are not available
 */
export function textSimilarity(textA: string, textB: string): number {
  const wordsA = new Set(textA.toLowerCase().split(/\s+/));
  const wordsB = new Set(textB.toLowerCase().split(/\s+/));

  const intersection = new Set([...wordsA].filter((word) => wordsB.has(word)));
  const union = new Set([...wordsA, ...wordsB]);

  return intersection.size / union.size;
}
