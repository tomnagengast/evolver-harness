/**
 * Principle Ranking and Scoring
 *
 * Provides configurable ranking algorithms that combine multiple signals:
 * - Embedding similarity (semantic relevance)
 * - Tag overlap (categorical match)
 * - Triple matching (structured metadata)
 * - Bayesian principle score (effectiveness)
 */

import { cosineSimilarity } from "../distiller/embeddings";
import {
  calculatePrincipleScore,
  type Principle,
  type SearchQuery,
  type Triple,
} from "../types";

/**
 * Configuration for ranking weights
 */
export interface RankingConfig {
  /** Weight for embedding similarity (0-1) */
  embeddingWeight?: number;

  /** Weight for tag overlap (0-1) */
  tagWeight?: number;

  /** Weight for triple matching (0-1) */
  tripleWeight?: number;

  /** Weight for principle score (0-1) */
  scoreWeight?: number;

  /** Minimum similarity threshold for embeddings */
  minSimilarity?: number;
}

/**
 * Scored principle with detailed breakdown
 */
export interface RankedPrinciple {
  principle: Principle;

  /** Component scores */
  scores: {
    embedding?: number;
    tagOverlap: number;
    tripleMatch: number;
    principleScore: number;
  };

  /** Combined final score */
  finalScore: number;

  /** Ranking position (1-indexed) */
  rank?: number;

  /** Explanation of scoring */
  explanation: string;
}

/**
 * Default ranking configuration
 */
const DEFAULT_CONFIG: Required<RankingConfig> = {
  embeddingWeight: 0.5,
  tagWeight: 0.2,
  tripleWeight: 0.15,
  scoreWeight: 0.15,
  minSimilarity: 0.0,
};

/**
 * Rank principles based on query relevance and effectiveness
 */
export function rankPrinciples(
  principles: Principle[],
  query: SearchQuery,
  queryEmbedding?: number[],
  config: RankingConfig = {},
): RankedPrinciple[] {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  // Normalize weights to sum to 1.0
  const totalWeight =
    (queryEmbedding ? cfg.embeddingWeight : 0) +
    (query.tags?.length ? cfg.tagWeight : 0) +
    (query.triples?.length ? cfg.tripleWeight : 0) +
    cfg.scoreWeight;

  const normalizedWeights = {
    embedding: queryEmbedding ? cfg.embeddingWeight / totalWeight : 0,
    tag: query.tags?.length ? cfg.tagWeight / totalWeight : 0,
    triple: query.triples?.length ? cfg.tripleWeight / totalWeight : 0,
    score: cfg.scoreWeight / totalWeight,
  };

  const ranked: RankedPrinciple[] = [];

  for (const principle of principles) {
    // Calculate component scores
    const embeddingSimilarity =
      queryEmbedding && principle.embedding
        ? cosineSimilarity(queryEmbedding, principle.embedding)
        : undefined;

    const tagOverlap = calculateTagOverlap(principle, query);
    const tripleMatch = calculateTripleMatch(principle, query);
    const principleScore = calculatePrincipleScore(principle);

    // Apply minimum similarity threshold
    if (
      embeddingSimilarity !== undefined &&
      embeddingSimilarity < cfg.minSimilarity
    ) {
      continue;
    }

    // Calculate weighted final score
    let finalScore = 0;

    if (embeddingSimilarity !== undefined) {
      finalScore += embeddingSimilarity * normalizedWeights.embedding;
    }

    finalScore += tagOverlap * normalizedWeights.tag;
    finalScore += tripleMatch * normalizedWeights.triple;
    finalScore += principleScore * normalizedWeights.score;

    // Generate explanation
    const explanation = generateExplanation(
      {
        embedding: embeddingSimilarity,
        tagOverlap,
        tripleMatch,
        principleScore,
      },
      normalizedWeights,
      query,
    );

    ranked.push({
      principle,
      scores: {
        embedding: embeddingSimilarity,
        tagOverlap,
        tripleMatch,
        principleScore,
      },
      finalScore,
      explanation,
    });
  }

  // Sort by final score descending
  ranked.sort((a, b) => b.finalScore - a.finalScore);

  // Add ranks
  ranked.forEach((item, index) => {
    item.rank = index + 1;
  });

  return ranked;
}

/**
 * Calculate tag overlap score (0-1)
 * Returns the Jaccard similarity of tag sets
 */
export function calculateTagOverlap(
  principle: Principle,
  query: SearchQuery,
): number {
  if (!query.tags || query.tags.length === 0) {
    return 1.0; // No tag filter = full match
  }

  const principalTags = new Set(principle.tags);
  const queryTags = new Set(query.tags);

  // Count matching tags
  const intersection = [...queryTags].filter((tag) =>
    principalTags.has(tag),
  ).length;

  // Jaccard similarity
  const union = new Set([...principalTags, ...queryTags]).size;

  if (union === 0) {
    return 0;
  }

  return intersection / union;
}

/**
 * Calculate triple match score (0-1)
 * Returns fraction of query triples that match principle triples
 */
export function calculateTripleMatch(
  principle: Principle,
  query: SearchQuery,
): number {
  if (!query.triples || query.triples.length === 0) {
    return 1.0; // No triple filter = full match
  }

  let matches = 0;

  for (const queryTriple of query.triples) {
    if (tripleExists(queryTriple, principle.triples)) {
      matches++;
    }
  }

  return matches / query.triples.length;
}

/**
 * Check if a triple exists in a list of triples
 */
function tripleExists(target: Triple, triples: Triple[]): boolean {
  for (const triple of triples) {
    if (
      triple.subject === target.subject &&
      triple.relation === target.relation &&
      triple.object === target.object
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Generate human-readable explanation of scoring
 */
function generateExplanation(
  scores: {
    embedding?: number;
    tagOverlap: number;
    tripleMatch: number;
    principleScore: number;
  },
  weights: {
    embedding: number;
    tag: number;
    triple: number;
    score: number;
  },
  query: SearchQuery,
): string {
  const parts: string[] = [];

  if (scores.embedding !== undefined && weights.embedding > 0) {
    parts.push(
      `Semantic: ${(scores.embedding * 100).toFixed(0)}% (weight: ${(weights.embedding * 100).toFixed(0)}%)`,
    );
  }

  if (query.tags?.length && weights.tag > 0) {
    parts.push(
      `Tags: ${(scores.tagOverlap * 100).toFixed(0)}% (weight: ${(weights.tag * 100).toFixed(0)}%)`,
    );
  }

  if (query.triples?.length && weights.triple > 0) {
    parts.push(
      `Triples: ${(scores.tripleMatch * 100).toFixed(0)}% (weight: ${(weights.triple * 100).toFixed(0)}%)`,
    );
  }

  if (weights.score > 0) {
    parts.push(
      `Effectiveness: ${(scores.principleScore * 100).toFixed(0)}% (weight: ${(weights.score * 100).toFixed(0)}%)`,
    );
  }

  return parts.join("; ");
}

/**
 * Filter ranked principles by minimum final score
 */
export function filterByMinScore(
  ranked: RankedPrinciple[],
  minScore: number,
): RankedPrinciple[] {
  return ranked.filter((r) => r.finalScore >= minScore);
}

/**
 * Get top-k ranked principles
 */
export function topK(ranked: RankedPrinciple[], k: number): RankedPrinciple[] {
  return ranked.slice(0, k);
}

/**
 * Diversity-aware ranking: Re-rank to reduce redundancy
 * Uses Maximal Marginal Relevance (MMR) algorithm
 */
export function diversityRanking(
  ranked: RankedPrinciple[],
  lambda = 0.7, // Balance between relevance (1.0) and diversity (0.0)
): RankedPrinciple[] {
  if (ranked.length <= 1) {
    return ranked;
  }

  const selected: RankedPrinciple[] = [];
  const remaining = [...ranked];

  // Start with top-ranked item
  selected.push(remaining.shift()!);

  while (remaining.length > 0) {
    let bestIndex = 0;
    let bestMMR = Number.NEGATIVE_INFINITY;

    for (let i = 0; i < remaining.length; i++) {
      const candidate = remaining[i];
      const relevance = candidate.finalScore;

      // Calculate max similarity to already selected items
      let maxSimilarity = 0;

      for (const selectedItem of selected) {
        const sim = calculatePrincipleSimilarity(
          candidate.principle,
          selectedItem.principle,
        );
        maxSimilarity = Math.max(maxSimilarity, sim);
      }

      // MMR = lambda * relevance - (1 - lambda) * maxSimilarity
      const mmr = lambda * relevance - (1 - lambda) * maxSimilarity;

      if (mmr > bestMMR) {
        bestMMR = mmr;
        bestIndex = i;
      }
    }

    selected.push(remaining.splice(bestIndex, 1)[0]);
  }

  // Update ranks
  selected.forEach((item, index) => {
    item.rank = index + 1;
  });

  return selected;
}

/**
 * Calculate similarity between two principles (for diversity ranking)
 * Uses tag overlap and text-based similarity
 */
function calculatePrincipleSimilarity(p1: Principle, p2: Principle): number {
  // Tag overlap
  const tags1 = new Set(p1.tags);
  const tags2 = new Set(p2.tags);
  const tagIntersection = [...tags1].filter((t) => tags2.has(t)).length;
  const tagUnion = new Set([...tags1, ...tags2]).size;
  const tagSim = tagUnion > 0 ? tagIntersection / tagUnion : 0;

  // Embedding similarity if available
  if (
    p1.embedding &&
    p2.embedding &&
    p1.embedding.length === p2.embedding.length
  ) {
    const embSim = cosineSimilarity(p1.embedding, p2.embedding);
    return (tagSim + embSim) / 2;
  }

  return tagSim;
}

