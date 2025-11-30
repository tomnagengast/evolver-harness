/**
 * Distiller class for extracting principles from traces
 *
 * Implements offline distillation process:
 * - Analyzes traces using Claude API
 * - Extracts principles in "When X, do Y" format
 * - Generates embeddings for similarity matching
 * - Merges/dedupes similar principles
 * - Updates existing principles when similar ones exist
 */

import { query } from "@anthropic-ai/claude-agent-sdk";
import type { ExpBaseStorage } from "../storage/expbase.js";
import type {
  DistillationConfig,
  DistillationResult,
  NewPrinciple,
  Principle,
  Trace,
  Triple,
} from "../types.js";
import {
  type EmbeddingConfig,
  findSimilarPrinciples,
  generateEmbedding,
} from "./embeddings.js";
import {
  DISTILLATION_SYSTEM_PROMPT,
  DISTILLATION_USER_PROMPT_TEMPLATE,
} from "./prompts.js";

/**
 * Configuration for the Distiller
 */
export interface DistillerConfig {
  /** Model to use for distillation (default: claude-sonnet-4-5-20250929) */
  model?: string;

  /** Similarity threshold for merging principles (0-1, default: 0.85) */
  similarityThreshold?: number;

  /** Maximum examples to keep per principle (default: 5) */
  maxExamplesPerPrinciple?: number;

  /** Minimum outcome score to consider for distillation (default: 0.0) */
  minOutcomeScore?: number;

  /** Embedding configuration */
  embeddingConfig?: EmbeddingConfig;

  /** Rate limiting delay between API calls in ms (default: 1000) */
  rateLimitDelayMs?: number;

  /** Enable verbose logging (default: false) */
  verbose?: boolean;
}

/**
 * Result from analyzing a single trace
 */
interface TraceAnalysisResult {
  classification: "success" | "failure" | "partial";
  explanation: string;
  principles: Array<{
    text: string;
    confidence: number;
    rationale: string;
  }>;
  triples: Triple[];
  tags: string[];
}

/**
 * Decision about whether to merge a new principle
 */
interface DeduplicationDecision {
  decision: "stand_alone" | "merge" | "enhance";
  target_principle_id?: string;
  reasoning: string;
  merged_text?: string;
}

/**
 * Distiller class for offline principle extraction
 */
export class Distiller {
  private storage: ExpBaseStorage;
  private config: Required<Omit<DistillerConfig, "embeddingConfig">> & {
    embeddingConfig: EmbeddingConfig;
  };

  constructor(storage: ExpBaseStorage, config: DistillerConfig = {}) {
    this.storage = storage;

    this.config = {
      model: config.model || "claude-sonnet-4-5-20250929",
      similarityThreshold: config.similarityThreshold ?? 0.85,
      maxExamplesPerPrinciple: config.maxExamplesPerPrinciple ?? 5,
      minOutcomeScore: config.minOutcomeScore ?? 0.0,
      embeddingConfig: config.embeddingConfig || {},
      rateLimitDelayMs: config.rateLimitDelayMs ?? 1000,
      verbose: config.verbose ?? false,
    };
  }

  /**
   * Distill principles from a single trace
   */
  async distillTrace(traceId: string): Promise<DistillationResult> {
    const startTime = Date.now();
    const trace = this.storage.getTrace(traceId);

    if (!trace) {
      throw new Error(`Trace ${traceId} not found`);
    }

    this.log(`Distilling trace ${traceId}...`);

    const result: DistillationResult = {
      new_principles: [],
      updated_principles: [],
      traces_processed: 1,
      traces_used: 0,
      duration_ms: 0,
      timestamp: new Date().toISOString(),
      config: this.buildDistillationConfig(),
      issues: [],
    };

    try {
      // Check if trace meets minimum score requirement
      if (trace.outcome.score < this.config.minOutcomeScore) {
        this.log(
          `Skipping trace ${traceId}: score ${trace.outcome.score} below threshold`,
        );
        result.issues?.push({
          severity: "info",
          message: `Trace score ${trace.outcome.score} below minimum ${this.config.minOutcomeScore}`,
          trace_id: traceId,
        });
        result.duration_ms = Date.now() - startTime;
        return result;
      }

      // Analyze trace to extract principles
      const analysis = await this.analyzeTrace(trace);

      // Process each extracted principle
      for (const principleData of analysis.principles) {
        try {
          await this.processExtractedPrinciple(
            principleData,
            trace,
            analysis.triples,
            analysis.tags,
            result,
          );
        } catch (error) {
          result.issues?.push({
            severity: "error",
            message: `Failed to process principle: ${error instanceof Error ? error.message : String(error)}`,
            trace_id: traceId,
          });
        }
      }

      result.traces_used = 1;
    } catch (error) {
      result.issues?.push({
        severity: "error",
        message: `Failed to analyze trace: ${error instanceof Error ? error.message : String(error)}`,
        trace_id: traceId,
      });
    }

    result.duration_ms = Date.now() - startTime;
    return result;
  }

  /**
   * Distill principles from multiple traces
   */
  async distillTraces(traceIds: string[]): Promise<DistillationResult> {
    const startTime = Date.now();

    this.log(`Distilling ${traceIds.length} traces...`);

    const result: DistillationResult = {
      new_principles: [],
      updated_principles: [],
      traces_processed: traceIds.length,
      traces_used: 0,
      duration_ms: 0,
      timestamp: new Date().toISOString(),
      config: this.buildDistillationConfig(),
      issues: [],
    };

    // Process each trace individually
    for (let i = 0; i < traceIds.length; i++) {
      if (i > 0 && this.config.rateLimitDelayMs > 0) {
        await this.delay(this.config.rateLimitDelayMs);
      }

      const traceResult = await this.distillTrace(traceIds[i]);

      // Merge results
      result.new_principles.push(...traceResult.new_principles);
      result.updated_principles.push(...traceResult.updated_principles);
      result.traces_used += traceResult.traces_used;
      result.issues?.push(...(traceResult.issues || []));
    }

    result.duration_ms = Date.now() - startTime;
    return result;
  }

  /**
   * Distill from N most recent undistilled traces
   */
  async distillRecent(count: number): Promise<DistillationResult> {
    const allTraces = this.storage.getAllTraces();
    const allPrinciples = this.storage.getAllPrinciples();

    // Get trace IDs that are already referenced in principles
    const referencedTraceIds = new Set<string>();
    for (const principle of allPrinciples) {
      for (const example of principle.examples) {
        referencedTraceIds.add(example.trace_id);
      }
    }

    // Filter to undistilled traces
    const undistilledTraces = allTraces.filter(
      (trace) => !referencedTraceIds.has(trace.id),
    );

    this.log(`Found ${undistilledTraces.length} undistilled traces`);

    // Take most recent N traces
    const tracesToDistill = undistilledTraces
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, count);

    if (tracesToDistill.length === 0) {
      this.log("No traces to distill");
      return {
        new_principles: [],
        updated_principles: [],
        traces_processed: 0,
        traces_used: 0,
        duration_ms: 0,
        timestamp: new Date().toISOString(),
        config: this.buildDistillationConfig(),
      };
    }

    return this.distillTraces(tracesToDistill.map((t) => t.id));
  }

  /**
   * Run deduplication pass on all principles
   */
  async deduplicatePrinciples(): Promise<{
    merged: number;
    updated_principles: Principle[];
  }> {
    this.log("Running deduplication pass...");

    const allPrinciples = this.storage.getAllPrinciples();
    const merged: string[] = [];
    const updated: Principle[] = [];

    // Ensure all principles have embeddings
    for (const principle of allPrinciples) {
      if (!principle.embedding) {
        try {
          const embedding = await generateEmbedding(
            principle.text,
            this.config.embeddingConfig,
          );
          const _updatedPrinciple = this.storage.updatePrinciple(principle.id, {
            embedding,
          });
          this.log(`Generated embedding for principle ${principle.id}`);
          principle.embedding = embedding;
        } catch (error) {
          this.log(
            `Failed to generate embedding for ${principle.id}: ${error}`,
          );
        }
      }
    }

    // Find and merge similar principles
    for (let i = 0; i < allPrinciples.length; i++) {
      const principle = allPrinciples[i];

      // Skip if already merged
      if (merged.includes(principle.id)) {
        continue;
      }

      if (!principle.embedding) {
        continue;
      }

      // Find similar principles
      const similar = findSimilarPrinciples(
        principle.embedding,
        allPrinciples.filter(
          (p) => p.id !== principle.id && !merged.includes(p.id),
        ),
        this.config.similarityThreshold,
      );

      if (similar.length > 0) {
        this.log(
          `Found ${similar.length} similar principles for ${principle.id}`,
        );

        // Merge similar principles into this one
        for (const { principle: similarPrinciple, similarity } of similar) {
          try {
            const updatedPrinciple = this.mergePrinciples(
              principle,
              similarPrinciple,
            );
            updated.push(updatedPrinciple);
            merged.push(similarPrinciple.id);

            this.log(
              `Merged ${similarPrinciple.id} into ${principle.id} (similarity: ${similarity.toFixed(3)})`,
            );
          } catch (error) {
            this.log(`Failed to merge principles: ${error}`);
          }
        }
      }
    }

    return {
      merged: merged.length,
      updated_principles: updated,
    };
  }

  /**
   * Prune low-scoring principles
   */
  prunePrinciples(threshold: number, minUsageCount = 10): string[] {
    this.log(
      `Pruning principles with score < ${threshold} and usage >= ${minUsageCount}...`,
    );
    const prunedIds = this.storage.pruneLowScorePrinciples(
      threshold,
      minUsageCount,
    );
    this.log(`Pruned ${prunedIds.length} principles`);
    return prunedIds;
  }

  // Private helper methods

  /**
   * Analyze a trace using Claude Agent SDK
   */
  private async analyzeTrace(trace: Trace): Promise<TraceAnalysisResult> {
    const prompt = DISTILLATION_USER_PROMPT_TEMPLATE(trace);

    try {
      const stream = query({
        prompt,
        options: {
          model: this.config.model,
          systemPrompt: DISTILLATION_SYSTEM_PROMPT,
        },
      });

      let responseText = "";
      for await (const item of stream) {
        if (item.type === "assistant") {
          for (const chunk of item.message.content) {
            if (chunk.type === "text") {
              responseText += chunk.text;
            }
          }
        }
      }

      // Parse JSON response
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error("Failed to extract JSON from response");
      }

      const analysis = JSON.parse(jsonMatch[0]) as TraceAnalysisResult;
      return analysis;
    } catch (error) {
      throw new Error(
        `Failed to analyze trace: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Process an extracted principle: generate embedding, check for duplicates, add or update
   */
  private async processExtractedPrinciple(
    principleData: { text: string; confidence: number; rationale: string },
    trace: Trace,
    triples: Triple[],
    tags: string[],
    result: DistillationResult,
  ): Promise<void> {
    // Generate embedding
    const embedding = await generateEmbedding(
      principleData.text,
      this.config.embeddingConfig,
    );

    // Check for similar existing principles
    const existingPrinciples = this.storage.getAllPrinciples();
    const similar = findSimilarPrinciples(
      embedding,
      existingPrinciples,
      this.config.similarityThreshold,
    );

    if (similar.length > 0) {
      // Update existing principle
      const existingPrinciple = similar[0].principle;
      const similarity = similar[0].similarity;

      this.log(
        `Found similar principle ${existingPrinciple.id} (similarity: ${similarity.toFixed(3)})`,
      );

      // Add trace as example
      const examples = [...existingPrinciple.examples];
      if (!examples.find((ex) => ex.trace_id === trace.id)) {
        examples.push({
          trace_id: trace.id,
          relevance_note: principleData.rationale,
          similarity_score: similarity,
        });

        // Keep only most recent examples
        if (examples.length > this.config.maxExamplesPerPrinciple) {
          examples.sort(
            (a, b) => (b.similarity_score || 0) - (a.similarity_score || 0),
          );
          examples.splice(this.config.maxExamplesPerPrinciple);
        }
      }

      // Merge tags and triples
      const mergedTags = Array.from(
        new Set([...existingPrinciple.tags, ...tags]),
      );
      const mergedTriples = [...existingPrinciple.triples];

      // Add new triples that don't exist
      for (const triple of triples) {
        const exists = mergedTriples.some(
          (t) =>
            t.subject === triple.subject &&
            t.relation === triple.relation &&
            t.object === triple.object,
        );
        if (!exists) {
          mergedTriples.push(triple);
        }
      }

      const updatedPrinciple = this.storage.updatePrinciple(
        existingPrinciple.id,
        {
          examples,
          tags: mergedTags,
          triples: mergedTriples,
          confidence: Math.max(
            existingPrinciple.confidence || 0,
            principleData.confidence,
          ),
          version: (existingPrinciple.version || 1) + 1,
        },
      );

      result.updated_principles.push(updatedPrinciple);
      this.log(`Updated principle ${updatedPrinciple.id}`);
    } else {
      // Create new principle
      const newPrinciple: NewPrinciple = {
        text: principleData.text,
        triples,
        tags,
        examples: [
          {
            trace_id: trace.id,
            relevance_note: principleData.rationale,
          },
        ],
        embedding,
        confidence: principleData.confidence,
        source: "distilled",
      };

      const addedPrinciple = this.storage.addPrinciple(newPrinciple);
      result.new_principles.push(addedPrinciple);
      this.log(`Created new principle ${addedPrinciple.id}`);
    }
  }

  /**
   * Merge two principles together
   */
  private mergePrinciples(target: Principle, source: Principle): Principle {
    // Merge examples
    const examples = [...target.examples, ...source.examples];
    const uniqueExamples = examples.filter(
      (ex, idx, arr) =>
        arr.findIndex((e) => e.trace_id === ex.trace_id) === idx,
    );

    // Keep only top examples
    if (uniqueExamples.length > this.config.maxExamplesPerPrinciple) {
      uniqueExamples.sort(
        (a, b) => (b.similarity_score || 0) - (a.similarity_score || 0),
      );
      uniqueExamples.splice(this.config.maxExamplesPerPrinciple);
    }

    // Merge tags
    const mergedTags = Array.from(new Set([...target.tags, ...source.tags]));

    // Merge triples
    const mergedTriples = [...target.triples];
    for (const triple of source.triples) {
      const exists = mergedTriples.some(
        (t) =>
          t.subject === triple.subject &&
          t.relation === triple.relation &&
          t.object === triple.object,
      );
      if (!exists) {
        mergedTriples.push(triple);
      }
    }

    // Update target principle
    const updatedPrinciple = this.storage.updatePrinciple(target.id, {
      examples: uniqueExamples,
      tags: mergedTags,
      triples: mergedTriples,
      use_count: target.use_count + source.use_count,
      success_count: target.success_count + source.success_count,
      confidence: Math.max(target.confidence || 0, source.confidence || 0),
      version: (target.version || 1) + 1,
    });

    // Delete source principle
    this.storage.deletePrinciple(source.id);

    return updatedPrinciple;
  }

  /**
   * Build DistillationConfig from current settings
   */
  private buildDistillationConfig(): DistillationConfig {
    return {
      similarity_threshold: this.config.similarityThreshold,
      max_examples_per_principle: this.config.maxExamplesPerPrinciple,
      min_outcome_score: this.config.minOutcomeScore,
      merge_similar_principles: true,
      distillation_model: this.config.model,
    };
  }

  /**
   * Log message if verbose mode is enabled
   */
  private log(message: string): void {
    if (this.config.verbose) {
      console.log(`[Distiller] ${message}`);
    }
  }

  /**
   * Delay execution for rate limiting
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
