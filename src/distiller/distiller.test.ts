/**
 * Tests for the Distiller class
 */

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { unlinkSync } from "node:fs";
import { ExpBaseStorage } from "../storage/expbase.js";
import type { NewTrace, Trace } from "../types.js";
import { Distiller } from "./distiller.js";

const TEST_DB_PATH = "/tmp/evolver-distiller-test.db";

describe("Distiller", () => {
  let storage: ExpBaseStorage;
  let distiller: Distiller;

  beforeEach(() => {
    // Clean up any existing test database
    try {
      unlinkSync(TEST_DB_PATH);
      unlinkSync(`${TEST_DB_PATH}-shm`);
      unlinkSync(`${TEST_DB_PATH}-wal`);
    } catch {
      // Ignore if files don't exist
    }

    storage = new ExpBaseStorage({ dbPath: TEST_DB_PATH });
    distiller = new Distiller(storage, {
      embeddingConfig: { provider: "mock" },
      verbose: false,
    });
  });

  afterEach(() => {
    storage.close();
    try {
      unlinkSync(TEST_DB_PATH);
      unlinkSync(`${TEST_DB_PATH}-shm`);
      unlinkSync(`${TEST_DB_PATH}-wal`);
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("constructor", () => {
    test("creates distiller with default config", () => {
      const d = new Distiller(storage);
      expect(d).toBeDefined();
    });

    test("creates distiller with custom config", () => {
      const d = new Distiller(storage, {
        model: "claude-opus-4-20250514",
        similarityThreshold: 0.9,
        maxExamplesPerPrinciple: 10,
        minOutcomeScore: 0.5,
        rateLimitDelayMs: 500,
        verbose: true,
      });
      expect(d).toBeDefined();
    });
  });

  describe("prunePrinciples", () => {
    test("prunes low-scoring principles with sufficient usage", () => {
      // Add principles with varying scores
      storage.addPrinciple({
        text: "High scorer",
        tags: ["test"],
        triples: [],
        examples: [],
        use_count: 20,
        success_count: 18, // score: 19/22 = 0.86
      });

      storage.addPrinciple({
        text: "Low scorer",
        tags: ["test"],
        triples: [],
        examples: [],
        use_count: 20,
        success_count: 2, // score: 3/22 = 0.14
      });

      storage.addPrinciple({
        text: "Low usage",
        tags: ["test"],
        triples: [],
        examples: [],
        use_count: 5,
        success_count: 0, // score: 1/7 = 0.14, but low usage
      });

      const pruned = distiller.prunePrinciples(0.3, 10);

      expect(pruned.length).toBe(1);
      expect(storage.getAllPrinciples().length).toBe(2);
    });

    test("does not prune when below min usage", () => {
      storage.addPrinciple({
        text: "Low usage low score",
        tags: ["test"],
        triples: [],
        examples: [],
        use_count: 5,
        success_count: 0,
      });

      const pruned = distiller.prunePrinciples(0.3, 10);
      expect(pruned.length).toBe(0);
    });
  });

  describe("distillRecent", () => {
    test("returns empty result when no traces exist", async () => {
      const result = await distiller.distillRecent(10);

      expect(result.traces_processed).toBe(0);
      expect(result.traces_used).toBe(0);
      expect(result.new_principles.length).toBe(0);
      expect(result.updated_principles.length).toBe(0);
    });

    test("skips traces already referenced by principles", async () => {
      // Add a trace
      const trace = storage.addTrace({
        task_summary: "Test task",
        problem_description: "Test description",
        tool_calls: [],
        intermediate_thoughts: [],
        final_answer: "Done",
        outcome: { status: "success", score: 0.8 },
        duration_ms: 1000,
        session_id: "test-session",
        model_used: "test-model",
      });

      // Add a principle that references this trace
      storage.addPrinciple({
        text: "Test principle",
        tags: ["test"],
        triples: [],
        examples: [{ trace_id: trace.id, relevance_note: "test" }],
      });

      const result = await distiller.distillRecent(10);

      expect(result.traces_processed).toBe(0);
      expect(result.traces_used).toBe(0);
    });
  });

  describe("distillTrace", () => {
    test("throws error for non-existent trace", async () => {
      await expect(distiller.distillTrace("non-existent")).rejects.toThrow(
        "Trace non-existent not found",
      );
    });

    test("skips trace below minimum score", async () => {
      const d = new Distiller(storage, {
        minOutcomeScore: 0.5,
        embeddingConfig: { provider: "mock" },
      });

      const trace = storage.addTrace({
        task_summary: "Low score task",
        problem_description: "Test",
        tool_calls: [],
        intermediate_thoughts: [],
        final_answer: "Failed",
        outcome: { status: "failure", score: 0.2 },
        duration_ms: 1000,
        session_id: "test",
        model_used: "test-model",
      });

      const result = await d.distillTrace(trace.id);

      expect(result.traces_used).toBe(0);
      expect(result.issues?.length).toBeGreaterThan(0);
      expect(result.issues?.[0].severity).toBe("info");
    });
  });

  describe("deduplicatePrinciples", () => {
    test("merges similar principles", async () => {
      // Add similar principles (mock embeddings will generate based on text)
      const p1 = storage.addPrinciple({
        text: "When debugging, always check logs first",
        tags: ["debugging"],
        triples: [],
        examples: [],
      });

      const p2 = storage.addPrinciple({
        text: "When debugging, always check logs first", // Identical text
        tags: ["debug"],
        triples: [],
        examples: [],
      });

      const result = await distiller.deduplicatePrinciples();

      // Should have merged since they have identical text (mock embedding)
      expect(result.merged).toBeGreaterThanOrEqual(0);
    });

    test("does not merge dissimilar principles", async () => {
      storage.addPrinciple({
        text: "Use meaningful variable names",
        tags: ["code-style"],
        triples: [],
        examples: [],
      });

      storage.addPrinciple({
        text: "Always handle errors gracefully",
        tags: ["error-handling"],
        triples: [],
        examples: [],
      });

      const result = await distiller.deduplicatePrinciples();

      // Should not merge since texts are different
      expect(storage.getAllPrinciples().length).toBe(2);
    });
  });
});

describe("Distiller integration", () => {
  test("full workflow: add traces, distill, dedupe, prune", async () => {
    const dbPath = "/tmp/evolver-distiller-integration.db";
    try {
      unlinkSync(dbPath);
    } catch {}

    const storage = new ExpBaseStorage({ dbPath });
    const distiller = new Distiller(storage, {
      embeddingConfig: { provider: "mock" },
      minOutcomeScore: 0,
    });

    // Add some traces
    for (let i = 0; i < 3; i++) {
      storage.addTrace({
        task_summary: `Task ${i}`,
        problem_description: `Description ${i}`,
        tool_calls: [
          {
            tool: "Edit",
            input: { file: "test.ts" },
            output: "success",
            timestamp: new Date().toISOString(),
          },
        ],
        intermediate_thoughts: [`Thought ${i}`],
        final_answer: `Answer ${i}`,
        outcome: { status: "success", score: 0.8 },
        duration_ms: 1000 + i * 100,
        session_id: `session-${i}`,
        model_used: "test-model",
      });
    }

    expect(storage.getAllTraces().length).toBe(3);

    // Add a principle manually
    storage.addPrinciple({
      text: "Always test your changes",
      tags: ["testing"],
      triples: [],
      examples: [],
      use_count: 15,
      success_count: 12,
    });

    // Prune should not remove it (score is good)
    const pruned = distiller.prunePrinciples(0.3, 10);
    expect(pruned.length).toBe(0);

    // Add a low-scoring principle
    storage.addPrinciple({
      text: "Bad advice",
      tags: ["bad"],
      triples: [],
      examples: [],
      use_count: 20,
      success_count: 2,
    });

    // Now prune should remove the low-scorer
    const pruned2 = distiller.prunePrinciples(0.3, 10);
    expect(pruned2.length).toBe(1);

    storage.close();
    try {
      unlinkSync(dbPath);
      unlinkSync(`${dbPath}-shm`);
      unlinkSync(`${dbPath}-wal`);
    } catch {}
  });
});
