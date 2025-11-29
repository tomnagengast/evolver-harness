import assert from "node:assert";
import { unlinkSync } from "node:fs";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import { ExpBaseStorage } from "./expbase.js";

const TEST_DB_PATH = "/tmp/evolver-test.db";

describe("ExpBaseStorage", () => {
  let storage: ExpBaseStorage;

  beforeEach(() => {
    storage = new ExpBaseStorage({ dbPath: TEST_DB_PATH });
  });

  afterEach(() => {
    storage.close();
    try {
      unlinkSync(TEST_DB_PATH);
      unlinkSync(`${TEST_DB_PATH}-wal`);
      unlinkSync(`${TEST_DB_PATH}-shm`);
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("Principles", () => {
    it("addPrinciple creates a new principle", () => {
      const principle = storage.addPrinciple({
        text: "Test principle",
        tags: ["test"],
        triples: [],
        examples: [],
      });

      assert.ok(principle.id);
      assert.strictEqual(principle.text, "Test principle");
      assert.deepStrictEqual(principle.tags, ["test"]);
      assert.strictEqual(principle.use_count, 0);
      assert.strictEqual(principle.success_count, 0);
    });

    it("getPrinciple retrieves a principle by ID", () => {
      const created = storage.addPrinciple({
        text: "Test principle",
        tags: ["test"],
        triples: [],
        examples: [],
      });

      const retrieved = storage.getPrinciple(created.id);
      assert.ok(retrieved);
      assert.strictEqual(retrieved.text, "Test principle");
    });

    it("getPrinciple returns null for non-existent ID", () => {
      const result = storage.getPrinciple("non-existent-id");
      assert.strictEqual(result, null);
    });

    it("updatePrinciple modifies an existing principle", () => {
      const created = storage.addPrinciple({
        text: "Original text",
        tags: ["original"],
        triples: [],
        examples: [],
      });

      const updated = storage.updatePrinciple(created.id, {
        text: "Updated text",
        tags: ["updated"],
      });

      assert.strictEqual(updated.text, "Updated text");
      assert.deepStrictEqual(updated.tags, ["updated"]);
      assert.strictEqual(updated.created_at, created.created_at);
    });

    it("deletePrinciple removes a principle", () => {
      const created = storage.addPrinciple({
        text: "To delete",
        tags: [],
        triples: [],
        examples: [],
      });

      const deleted = storage.deletePrinciple(created.id);
      assert.strictEqual(deleted, true);

      const retrieved = storage.getPrinciple(created.id);
      assert.strictEqual(retrieved, null);
    });

    it("getAllPrinciples returns all principles", () => {
      storage.addPrinciple({
        text: "Principle 1",
        tags: [],
        triples: [],
        examples: [],
      });
      storage.addPrinciple({
        text: "Principle 2",
        tags: [],
        triples: [],
        examples: [],
      });

      const all = storage.getAllPrinciples();
      assert.strictEqual(all.length, 2);
    });

    it("searchPrinciples filters by tags", () => {
      storage.addPrinciple({
        text: "Debugging principle",
        tags: ["debugging", "test"],
        triples: [],
        examples: [],
      });
      storage.addPrinciple({
        text: "Performance principle",
        tags: ["performance"],
        triples: [],
        examples: [],
      });

      const results = storage.searchPrinciples({ tags: ["debugging"] });
      assert.strictEqual(results.length, 1);
      assert.strictEqual(results[0].text, "Debugging principle");
    });
  });

  describe("Scoring", () => {
    it("getPrincipleScore uses Bayesian formula", () => {
      const principle = storage.addPrinciple({
        text: "Test principle",
        tags: [],
        triples: [],
        examples: [],
        use_count: 10,
        success_count: 8,
      });

      // Score = (success + 1) / (use + 2) = 9 / 12 = 0.75
      const score = storage.getPrincipleScore(principle.id);
      assert.strictEqual(score, 0.75);
    });

    it("getPrincipleScores returns sorted scores", () => {
      storage.addPrinciple({
        text: "High score",
        tags: [],
        triples: [],
        examples: [],
        use_count: 10,
        success_count: 9,
      });
      storage.addPrinciple({
        text: "Low score",
        tags: [],
        triples: [],
        examples: [],
        use_count: 10,
        success_count: 2,
      });

      const scores = storage.getPrincipleScores();
      assert.strictEqual(scores.length, 2);
      assert.strictEqual(scores[0].principle.text, "High score");
      assert.strictEqual(scores[0].rank, 1);
      assert.strictEqual(scores[1].rank, 2);
    });

    it("recordUsage increments counters", () => {
      const principle = storage.addPrinciple({
        text: "Test principle",
        tags: [],
        triples: [],
        examples: [],
      });

      storage.recordUsage(principle.id, undefined, true);
      storage.recordUsage(principle.id, undefined, false);

      const updated = storage.getPrinciple(principle.id);
      assert.strictEqual(updated?.use_count, 2);
      assert.strictEqual(updated?.success_count, 1);
    });
  });

  describe("Traces", () => {
    it("addTrace creates a new trace", () => {
      const trace = storage.addTrace({
        task_summary: "Test task",
        problem_description: "Test problem",
        tool_calls: [
          {
            tool: "Read",
            input: {},
            output: "test",
            timestamp: "2024-01-01T00:00:00Z",
          },
        ],
        intermediate_thoughts: [],
        final_answer: "Done",
        outcome: { status: "success", score: 1.0 },
        duration_ms: 1000,
        model_used: "test-model",
        session_id: "test-session",
      });

      assert.ok(trace.id);
      assert.strictEqual(trace.task_summary, "Test task");
      assert.strictEqual(trace.outcome.status, "success");
    });

    it("getTrace retrieves a trace by ID", () => {
      const created = storage.addTrace({
        task_summary: "Test task",
        problem_description: "Test problem",
        tool_calls: [],
        intermediate_thoughts: [],
        final_answer: "Done",
        outcome: { status: "success", score: 1.0 },
        duration_ms: 1000,
        model_used: "test-model",
        session_id: "test-session",
      });

      const retrieved = storage.getTrace(created.id);
      assert.ok(retrieved);
      assert.strictEqual(retrieved.task_summary, "Test task");
    });

    it("getAllTraces returns all traces", () => {
      storage.addTrace({
        task_summary: "Task 1",
        problem_description: "",
        tool_calls: [],
        intermediate_thoughts: [],
        final_answer: "",
        outcome: { status: "success", score: 1.0 },
        duration_ms: 1000,
        model_used: "test-model",
        session_id: "test-session-1",
      });
      storage.addTrace({
        task_summary: "Task 2",
        problem_description: "",
        tool_calls: [],
        intermediate_thoughts: [],
        final_answer: "",
        outcome: { status: "failure", score: 0.0 },
        duration_ms: 2000,
        model_used: "test-model",
        session_id: "test-session-2",
      });

      const all = storage.getAllTraces();
      assert.strictEqual(all.length, 2);
    });
  });

  describe("Stats", () => {
    it("getStats returns comprehensive statistics", () => {
      storage.addPrinciple({
        text: "Test principle",
        tags: ["test"],
        triples: [],
        examples: [],
        use_count: 5,
        success_count: 4,
      });

      storage.addTrace({
        task_summary: "Test task",
        problem_description: "",
        tool_calls: [],
        intermediate_thoughts: [],
        final_answer: "",
        outcome: { status: "success", score: 1.0 },
        duration_ms: 1000,
        model_used: "test-model",
        session_id: "test-session",
      });

      const stats = storage.getStats();
      assert.strictEqual(stats.principle_count, 1);
      assert.strictEqual(stats.trace_count, 1);
      assert.ok(stats.avg_principle_score > 0);
    });
  });

  describe("Pruning", () => {
    it("pruneLowScorePrinciples removes low-scoring principles", () => {
      storage.addPrinciple({
        text: "High score",
        tags: [],
        triples: [],
        examples: [],
        use_count: 10,
        success_count: 9,
      });
      storage.addPrinciple({
        text: "Low score",
        tags: [],
        triples: [],
        examples: [],
        use_count: 10,
        success_count: 1,
      });

      const pruned = storage.pruneLowScorePrinciples(0.5, 5);
      assert.strictEqual(pruned.length, 1);

      const remaining = storage.getAllPrinciples();
      assert.strictEqual(remaining.length, 1);
      assert.strictEqual(remaining[0].text, "High score");
    });
  });
});

