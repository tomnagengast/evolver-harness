import assert from "node:assert";
import { unlinkSync } from "node:fs";
import { afterEach, beforeEach, describe, it } from "node:test";
import { ExpBaseStorage } from "../src/storage/expbase.js";

const TEST_DB_PATH = "/tmp/evolver-hooks-test.db";

describe("Hooks Integration", () => {
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

  describe("SessionStart Hook Logic", () => {
    it("retrieves principles sorted by Bayesian score", () => {
      // Add principles with different scores
      storage.addPrinciple({
        text: "High score principle",
        tags: ["test"],
        triples: [],
        examples: [],
        use_count: 10,
        success_count: 9, // Score: 10/12 = 0.833
      });
      storage.addPrinciple({
        text: "Low score principle",
        tags: ["test"],
        triples: [],
        examples: [],
        use_count: 10,
        success_count: 2, // Score: 3/12 = 0.25
      });
      storage.addPrinciple({
        text: "Medium score principle",
        tags: ["test"],
        triples: [],
        examples: [],
        use_count: 10,
        success_count: 5, // Score: 6/12 = 0.5
      });

      // Simulate what session-start hook does
      const MIN_SCORE = 0.5;
      const MAX_PRINCIPLES = 10;

      const scores = storage.getPrincipleScores();
      const principles = scores
        .filter((s) => s.score >= MIN_SCORE)
        .slice(0, MAX_PRINCIPLES)
        .map((s) => s.principle);

      // Should have 2 principles with score >= 0.5 (high and medium)
      assert.strictEqual(principles.length, 2);
      assert.strictEqual(principles[0]?.text, "High score principle");
      assert.strictEqual(principles[1]?.text, "Medium score principle");
    });
  });

  describe("PromptSubmit Hook Logic", () => {
    const STOP_WORDS = new Set([
      "the",
      "a",
      "an",
      "and",
      "or",
      "but",
      "in",
      "on",
      "at",
      "to",
      "for",
      "with",
      "is",
      "are",
      "please",
      "help",
      "me",
    ]);

    function extractKeywords(prompt: string): string[] {
      return [
        ...new Set(
          prompt
            .toLowerCase()
            .replace(/[^a-z0-9\s]/g, " ")
            .split(/\s+/)
            .filter((w: string) => w.length > 2 && !STOP_WORDS.has(w)),
        ),
      ];
    }

    it("extracts keywords from prompt", () => {
      const prompt = "Help me fix the authentication bug in the login system";
      const keywords = extractKeywords(prompt);

      assert.ok(keywords.includes("fix"));
      assert.ok(keywords.includes("authentication"));
      assert.ok(keywords.includes("bug"));
      assert.ok(keywords.includes("login"));
      assert.ok(keywords.includes("system"));
      assert.ok(!keywords.includes("the"));
      assert.ok(!keywords.includes("help"));
      assert.ok(!keywords.includes("me"));
    });

    it("filters short prompts", () => {
      const isTaskPrompt = (prompt: string) => {
        if (prompt.length < 20) return false;
        if (/^(yes|no|ok|okay|sure|continue|y|n)\.?$/i.test(prompt.trim()))
          return false;
        return true;
      };

      assert.strictEqual(isTaskPrompt("yes"), false);
      assert.strictEqual(isTaskPrompt("continue"), false);
      assert.strictEqual(isTaskPrompt("ok"), false);
      assert.strictEqual(isTaskPrompt("Fix the bug"), false); // Too short
      assert.strictEqual(
        isTaskPrompt("Help me fix the authentication bug"),
        true,
      );
    });

    it("searches principles by keyword tags", () => {
      storage.addPrinciple({
        text: "Debug by reproducing first",
        tags: ["debugging", "bug", "reproduce"],
        triples: [],
        examples: [],
        use_count: 5,
        success_count: 4,
      });
      storage.addPrinciple({
        text: "Optimize database queries",
        tags: ["performance", "database", "optimization"],
        triples: [],
        examples: [],
        use_count: 5,
        success_count: 4,
      });

      const keywords = ["debugging", "bug"];
      const results = storage.searchPrinciples({
        tags: keywords,
        limit: 10,
        min_principle_score: 0.5,
        search_mode: "principles",
      });

      assert.strictEqual(results.length, 1);
      assert.strictEqual(results[0].text, "Debug by reproducing first");
    });
  });

  describe("PostToolUse Hook Logic", () => {
    it("truncates large outputs", () => {
      function truncate(value: unknown, maxLen = 5000): unknown {
        if (typeof value === "string" && value.length > maxLen) {
          return value.slice(0, maxLen) + "... [truncated]";
        }
        if (typeof value === "object" && value !== null) {
          const str = JSON.stringify(value);
          if (str.length > maxLen)
            return { _truncated: true, preview: str.slice(0, 500) };
        }
        return value;
      }

      const largeString = "x".repeat(10000);
      const truncated = truncate(largeString) as string;

      assert.ok(truncated.length < largeString.length);
      assert.ok(truncated.endsWith("... [truncated]"));
    });

    it("accumulates tool calls in session state", () => {
      interface SessionState {
        sessionId: string;
        startTime: string;
        toolCalls: Array<{
          tool: string;
          input: unknown;
          output: unknown;
          timestamp: string;
        }>;
      }

      const state: SessionState = {
        sessionId: "test-session",
        startTime: new Date().toISOString(),
        toolCalls: [],
      };

      // Simulate tool calls
      state.toolCalls.push({
        tool: "Read",
        input: { file_path: "/test.ts" },
        output: "file contents",
        timestamp: new Date().toISOString(),
      });

      state.toolCalls.push({
        tool: "Edit",
        input: { file_path: "/test.ts", old_string: "a", new_string: "b" },
        output: "success",
        timestamp: new Date().toISOString(),
      });

      assert.strictEqual(state.toolCalls.length, 2);
      assert.strictEqual(state.toolCalls[0].tool, "Read");
      assert.strictEqual(state.toolCalls[1].tool, "Edit");
    });
  });

  describe("SessionEnd Hook Logic", () => {
    it("infers outcome from tool calls", () => {
      type ToolCall = {
        tool: string;
        input: unknown;
        output: unknown;
        timestamp: string;
      };

      function inferOutcome(toolCalls: ToolCall[]) {
        if (toolCalls.length === 0)
          return { status: "partial" as const, score: 0.5 };

        const hasErrors = toolCalls.some((tc) => {
          const out =
            typeof tc.output === "string"
              ? tc.output
              : JSON.stringify(tc.output);
          return /error|failed/i.test(out);
        });

        const hasEdits = toolCalls.some((tc) =>
          ["Edit", "Write", "NotebookEdit"].includes(tc.tool),
        );

        if (hasErrors && !hasEdits)
          return { status: "failure" as const, score: 0.3 };
        if (hasEdits) return { status: "success" as const, score: 0.8 };
        return { status: "partial" as const, score: 0.5 };
      }

      // Test success case
      const successCalls: ToolCall[] = [
        {
          tool: "Read",
          input: {},
          output: "contents",
          timestamp: new Date().toISOString(),
        },
        {
          tool: "Edit",
          input: {},
          output: "success",
          timestamp: new Date().toISOString(),
        },
      ];
      assert.deepStrictEqual(inferOutcome(successCalls), {
        status: "success",
        score: 0.8,
      });

      // Test failure case
      const failureCalls: ToolCall[] = [
        {
          tool: "Read",
          input: {},
          output: "Error: file not found",
          timestamp: new Date().toISOString(),
        },
      ];
      assert.deepStrictEqual(inferOutcome(failureCalls), {
        status: "failure",
        score: 0.3,
      });

      // Test partial case
      const partialCalls: ToolCall[] = [
        {
          tool: "Read",
          input: {},
          output: "contents",
          timestamp: new Date().toISOString(),
        },
      ];
      assert.deepStrictEqual(inferOutcome(partialCalls), {
        status: "partial",
        score: 0.5,
      });
    });

    it("saves trace to storage", () => {
      const trace = storage.addTrace({
        task_summary: "Claude Code session",
        problem_description: "Session with 5 tool calls",
        tool_calls: [
          { tool: "Read", input: {}, output: "test", timestamp: "2024-01-01" },
        ],
        intermediate_thoughts: [],
        final_answer: "Session ended with success",
        outcome: { status: "success", score: 0.8 },
        duration_ms: 5000,
        model_used: "claude-3-opus",
        session_id: "test-session",
      });

      assert.ok(trace.id);
      assert.strictEqual(trace.task_summary, "Claude Code session");
      assert.strictEqual(trace.outcome.status, "success");

      const retrieved = storage.getTrace(trace.id);
      assert.ok(retrieved);
    });
  });
});

