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

    it("recordUsage increments counters with boolean", () => {
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

    it("recordUsage accepts fractional credit values", () => {
      const principle = storage.addPrinciple({
        text: "Test principle",
        tags: [],
        triples: [],
        examples: [],
      });

      // Record with fractional credits
      storage.recordUsage(principle.id, undefined, 0.8);
      storage.recordUsage(principle.id, undefined, 0.6);
      storage.recordUsage(principle.id, undefined, 0.4);

      const updated = storage.getPrinciple(principle.id);
      assert.strictEqual(updated?.use_count, 3);
      // success_count should be 0.8 + 0.6 + 0.4 = 1.8
      assert.ok(Math.abs((updated?.success_count ?? 0) - 1.8) < 0.01);
    });

    it("recordUsage clamps credit to 0-1 range", () => {
      const principle = storage.addPrinciple({
        text: "Test principle",
        tags: [],
        triples: [],
        examples: [],
      });

      // Attempt to record out-of-range credits
      storage.recordUsage(principle.id, undefined, 1.5); // Should clamp to 1.0
      storage.recordUsage(principle.id, undefined, -0.5); // Should clamp to 0.0

      const updated = storage.getPrinciple(principle.id);
      assert.strictEqual(updated?.use_count, 2);
      assert.strictEqual(updated?.success_count, 1.0); // 1.0 + 0.0
    });

    it("recordUsage returns event with credit field", () => {
      const principle = storage.addPrinciple({
        text: "Test principle",
        tags: [],
        triples: [],
        examples: [],
      });

      const event = storage.recordUsage(principle.id, undefined, 0.75);

      assert.strictEqual(event.credit, 0.75);
      assert.strictEqual(event.was_successful, true); // 0.75 >= 0.5
      assert.strictEqual(event.principle_id, principle.id);
    });

    it("recordUsage treats credit < 0.5 as unsuccessful", () => {
      const principle = storage.addPrinciple({
        text: "Test principle",
        tags: [],
        triples: [],
        examples: [],
      });

      const event = storage.recordUsage(principle.id, undefined, 0.3);

      assert.strictEqual(event.credit, 0.3);
      assert.strictEqual(event.was_successful, false); // 0.3 < 0.5
    });

    it("getPrincipleUsageHistory includes credit field", () => {
      const principle = storage.addPrinciple({
        text: "Test principle",
        tags: [],
        triples: [],
        examples: [],
      });

      storage.recordUsage(principle.id, undefined, 0.85);
      storage.recordUsage(principle.id, undefined, 0.25);

      const history = storage.getPrincipleUsageHistory(principle.id);

      assert.strictEqual(history.length, 2);
      // Check that credit values are present (order may vary based on timing)
      const credits = history.map((h) => h.credit).sort();
      assert.strictEqual(credits[0], 0.25);
      assert.strictEqual(credits[1], 0.85);

      // Verify was_successful correlates with credit >= 0.5
      for (const h of history) {
        assert.strictEqual(h.was_successful, h.credit >= 0.5);
      }
    });

    it("Bayesian score works with fractional success_count", () => {
      const principle = storage.addPrinciple({
        text: "Test principle",
        tags: [],
        triples: [],
        examples: [],
      });

      // Record 5 uses with varying credit
      storage.recordUsage(principle.id, undefined, 0.9);
      storage.recordUsage(principle.id, undefined, 0.7);
      storage.recordUsage(principle.id, undefined, 0.8);
      storage.recordUsage(principle.id, undefined, 0.6);
      storage.recordUsage(principle.id, undefined, 0.5);

      const updated = storage.getPrinciple(principle.id);
      assert.strictEqual(updated?.use_count, 5);
      // success_count = 0.9 + 0.7 + 0.8 + 0.6 + 0.5 = 3.5
      assert.ok(Math.abs((updated?.success_count ?? 0) - 3.5) < 0.01);

      // Score = (3.5 + 1) / (5 + 2) = 4.5 / 7 ≈ 0.643
      const score = storage.getPrincipleScore(principle.id);
      assert.ok(Math.abs(score - 0.643) < 0.01);
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
