/**
 * Experience Retriever
 *
 * Provides intelligent retrieval of principles from the experience base
 * combining semantic search, tag/triple filtering, and Bayesian scoring.
 */

import { ExpBaseStorage } from "../storage/expbase";
import {
  calculatePrincipleScore,
  type Principle,
  type PrincipleScore,
  type SearchQuery,
  type SearchResponse,
  type SearchResult,
} from "../types";

/**
 * Configuration for the ExperienceRetriever
 */
export interface RetrieverConfig {
  /** Path to the SQLite database */
  dbPath: string;

  /** Enable verbose logging */
  verbose?: boolean;

  /** Default number of results to return */
  defaultLimit?: number;

  /** Default minimum similarity score for semantic search */
  defaultMinSimilarity?: number;

  /** Default minimum principle score */
  defaultMinPrincipleScore?: number;
}

/**
 * Principle with computed relevance and score
 */
export interface ScoredPrinciple {
  principle: Principle;
  score: number;
  relevance: number;
  combined: number; // relevance * score
  matchReason: string;
}

/**
 * ExperienceRetriever provides intelligent retrieval of principles
 * from the experience base using multiple search modalities.
 */
export class ExperienceRetriever {
  private storage: ExpBaseStorage;
  private config: RetrieverConfig;

  constructor(config: RetrieverConfig) {
    this.config = {
      defaultLimit: 10,
      defaultMinSimilarity: 0.7,
      defaultMinPrincipleScore: 0.3,
      verbose: false,
      ...config,
    };

    this.storage = new ExpBaseStorage({
      dbPath: this.config.dbPath,
      verbose: this.config.verbose,
    });
  }

  /**
   * Main retrieval method that combines semantic search, filtering, and scoring
   */
  async searchExperience(query: SearchQuery): Promise<SearchResponse> {
    const startTime = Date.now();

    try {
      // Determine search mode
      const searchMode = query.search_mode || "principles";

      if (searchMode === "traces" || searchMode === "both") {
        // For now, we only implement principles search
        // Traces search would require additional implementation
        if (searchMode === "traces") {
          const traces = this.storage.searchTraces(query);
          const results: SearchResult[] = traces.map((trace) => ({
            type: "trace" as const,
            item: trace,
            match_reason: "Filter match",
          }));

          return {
            results,
            total_count: results.length,
            query_time_ms: Date.now() - startTime,
          };
        }
      }

      // Search principles
      const principles = this.storage.searchPrinciples(query);

      // Score and rank principles
      const scoredPrinciples = this.scoreAndRankPrinciples(principles, query);

      // Apply limit
      const limit = query.limit || this.config.defaultLimit || 10;
      const topPrinciples = scoredPrinciples.slice(0, limit);

      // Convert to search results
      const results: SearchResult[] = topPrinciples.map((sp) => ({
        type: "principle" as const,
        item: sp.principle,
        similarity_score: sp.relevance,
        match_reason: sp.matchReason,
      }));

      return {
        results,
        total_count: scoredPrinciples.length,
        query_time_ms: Date.now() - startTime,
        debug_info: this.config.verbose
          ? {
              scored_count: scoredPrinciples.length,
              top_scores: topPrinciples.map((sp) => ({
                id: sp.principle.id,
                score: sp.score,
                relevance: sp.relevance,
                combined: sp.combined,
              })),
            }
          : undefined,
      };
    } catch (error) {
      throw new Error(
        `Failed to search experience: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Score and rank principles by combining relevance and Bayesian score
   */
  private scoreAndRankPrinciples(
    principles: Principle[],
    query: SearchQuery,
  ): ScoredPrinciple[] {
    const scored: ScoredPrinciple[] = [];

    for (const principle of principles) {
      // Calculate Bayesian score: s(p) = (success + 1) / (use + 2)
      const score = calculatePrincipleScore(principle);

      // Calculate relevance score
      const relevance = this.calculateRelevance(principle, query);

      // Combined score: relevance * score
      const combined = relevance * score;

      // Generate match reason
      const matchReason = this.generateMatchReason(principle, query);

      scored.push({
        principle,
        score,
        relevance,
        combined,
        matchReason,
      });
    }

    // Sort by combined score (relevance * Bayesian score) descending
    scored.sort((a, b) => b.combined - a.combined);

    return scored;
  }

  /**
   * Calculate relevance score based on query matches
   */
  private calculateRelevance(principle: Principle, query: SearchQuery): number {
    let relevance = 1.0;

    // If no specific query criteria, all principles are equally relevant
    if (!query.query_text && !query.tags?.length && !query.triples?.length) {
      return relevance;
    }

    let matches = 0;
    let criteria = 0;

    // Text query matching (simple keyword matching)
    if (query.query_text) {
      criteria++;
      const queryLower = query.query_text.toLowerCase();
      const textLower = principle.text.toLowerCase();
      const keywords = queryLower.split(/\s+/).filter((w) => w.length > 2);

      let keywordMatches = 0;
      for (const keyword of keywords) {
        if (textLower.includes(keyword)) {
          keywordMatches++;
        }
      }

      if (keywords.length > 0) {
        matches += keywordMatches / keywords.length;
      }
    }

    // Tag matching
    if (query.tags && query.tags.length > 0) {
      criteria++;
      const matchedTags = query.tags.filter((tag) =>
        principle.tags.includes(tag),
      );
      matches += matchedTags.length / query.tags.length;
    }

    // Triple matching
    if (query.triples && query.triples.length > 0) {
      criteria++;
      let tripleMatches = 0;

      for (const queryTriple of query.triples) {
        for (const principleTriple of principle.triples) {
          if (
            queryTriple.subject === principleTriple.subject &&
            queryTriple.relation === principleTriple.relation &&
            queryTriple.object === principleTriple.object
          ) {
            tripleMatches++;
            break;
          }
        }
      }

      matches += tripleMatches / query.triples.length;
    }

    // Calculate final relevance (average of criteria matches)
    if (criteria > 0) {
      relevance = matches / criteria;
    }

    return relevance;
  }

  /**
   * Generate a human-readable explanation of why this principle matched
   */
  private generateMatchReason(
    principle: Principle,
    query: SearchQuery,
  ): string {
    const reasons: string[] = [];

    // Text matching
    if (query.query_text) {
      const queryLower = query.query_text.toLowerCase();
      const textLower = principle.text.toLowerCase();
      const keywords = queryLower.split(/\s+/).filter((w) => w.length > 2);
      const matchedKeywords = keywords.filter((k) => textLower.includes(k));

      if (matchedKeywords.length > 0) {
        reasons.push(`Matches keywords: ${matchedKeywords.join(", ")}`);
      }
    }

    // Tag matching
    if (query.tags && query.tags.length > 0) {
      const matchedTags = query.tags.filter((tag) =>
        principle.tags.includes(tag),
      );
      if (matchedTags.length > 0) {
        reasons.push(`Tags: ${matchedTags.join(", ")}`);
      }
    }

    // Triple matching
    if (query.triples && query.triples.length > 0) {
      let tripleCount = 0;
      for (const queryTriple of query.triples) {
        for (const principleTriple of principle.triples) {
          if (
            queryTriple.subject === principleTriple.subject &&
            queryTriple.relation === principleTriple.relation &&
            queryTriple.object === principleTriple.object
          ) {
            tripleCount++;
            break;
          }
        }
      }
      if (tripleCount > 0) {
        reasons.push(`Triples: ${tripleCount} match(es)`);
      }
    }

    // Add score information
    const score = calculatePrincipleScore(principle);
    reasons.push(
      `Score: ${score.toFixed(2)} (${principle.success_count}/${principle.use_count} success rate)`,
    );

    return reasons.length > 0 ? reasons.join("; ") : "General match";
  }

  /**
   * Record that a principle was used and track the outcome
   */
  async recordUsage(
    principleId: string,
    wasSuccessful: boolean,
    traceId?: string,
  ): Promise<void> {
    try {
      this.storage.recordUsage(principleId, traceId, wasSuccessful);

      if (this.config.verbose) {
        console.log(
          `Recorded usage for principle ${principleId}: ${wasSuccessful ? "success" : "failure"}`,
        );
      }
    } catch (error) {
      throw new Error(
        `Failed to record usage: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Get the top-k principles by Bayesian score
   */
  getTopPrinciples(k = 10): PrincipleScore[] {
    try {
      return this.storage.getPrincipleScores().slice(0, k);
    } catch (error) {
      throw new Error(
        `Failed to get top principles: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Get a specific principle by ID
   */
  getPrinciple(id: string): Principle | null {
    try {
      return this.storage.getPrinciple(id);
    } catch (error) {
      throw new Error(
        `Failed to get principle: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Close the database connection
   */
  close(): void {
    this.storage.close();
  }

  /**
   * Get the underlying storage instance (for advanced usage)
   */
  getStorage(): ExpBaseStorage {
    return this.storage;
  }
}

