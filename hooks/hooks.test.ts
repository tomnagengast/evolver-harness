import assert from "node:assert";
import { unlinkSync } from "node:fs";
import { afterEach, beforeEach, describe, it } from "node:test";
import { ExpBaseStorage } from "../src/storage/expbase.js";
import type { OutcomeSignals, UserFeedback } from "../src/types.js";

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
          return `${value.slice(0, maxLen)}... [truncated]`;
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
          input: Record<string, unknown>;
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
        input: Record<string, unknown>;
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

  describe("User Feedback Analysis", () => {
    // Replicate the feedback patterns from prompt-submit.ts
    const FEEDBACK_PATTERNS = {
      explicit_positive: [
        /\b(thanks|thank you|perfect|great|awesome|works|excellent|nice|good job|well done|thx|ty)\b/i,
        /^(yes|yep|yeah|correct|exactly|right)[.!]?$/i,
        /\bthat('s| is) (right|correct|perfect|great|exactly what)\b/i,
      ],
      explicit_negative: [
        /\b(wrong|incorrect|undo|revert|rollback|broken|failed|doesn't work|didn't work)\b/i,
        /\b(try again|start over|that's not|not what i|go back)\b/i,
        /^no[,.\s]|^nope\b/i,
      ],
    };

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
      "my",
    ]);

    function computeKeywordOverlap(a: string, b: string): number {
      const wordsA = new Set(
        a
          .toLowerCase()
          .split(/\W+/)
          .filter((w) => w.length > 3 && !STOP_WORDS.has(w)),
      );
      const wordsB = new Set(
        b
          .toLowerCase()
          .split(/\W+/)
          .filter((w) => w.length > 3 && !STOP_WORDS.has(w)),
      );
      if (wordsA.size === 0 || wordsB.size === 0) return 0;
      const intersection = [...wordsA].filter((w) => wordsB.has(w)).length;
      const union = new Set([...wordsA, ...wordsB]).size;
      return intersection / union;
    }

    function analyzeUserFeedback(
      currentPrompt: string,
      previousPrompts: string[],
      hasRecentToolCalls: boolean,
    ): UserFeedback {
      const promptIndex = previousPrompts.length;

      for (const pattern of FEEDBACK_PATTERNS.explicit_positive) {
        if (pattern.test(currentPrompt)) {
          return {
            sentiment: 1.0,
            type: "explicit_positive",
            confidence: 0.9,
            prompt_index: promptIndex,
          };
        }
      }

      for (const pattern of FEEDBACK_PATTERNS.explicit_negative) {
        if (pattern.test(currentPrompt)) {
          return {
            sentiment: 0.0,
            type: "explicit_negative",
            confidence: 0.9,
            prompt_index: promptIndex,
          };
        }
      }

      if (previousPrompts.length > 0) {
        const lastPrompt = previousPrompts[previousPrompts.length - 1];
        const similarity = computeKeywordOverlap(currentPrompt, lastPrompt);
        if (similarity > 0.6) {
          return {
            sentiment: 0.2,
            type: "implicit_retry",
            confidence: 0.7,
            prompt_index: promptIndex,
          };
        }
      }

      if (previousPrompts.length > 0 && hasRecentToolCalls) {
        const lastPrompt = previousPrompts[previousPrompts.length - 1];
        const similarity = computeKeywordOverlap(currentPrompt, lastPrompt);
        if (similarity < 0.2) {
          return {
            sentiment: 0.7,
            type: "implicit_continuation",
            confidence: 0.6,
            prompt_index: promptIndex,
          };
        }
      }

      return {
        sentiment: 0.5,
        type: "neutral",
        confidence: 0.5,
        prompt_index: promptIndex,
      };
    }

    it("detects explicit positive feedback", () => {
      const feedback = analyzeUserFeedback(
        "thanks, that works perfectly!",
        [],
        false,
      );
      assert.strictEqual(feedback.type, "explicit_positive");
      assert.strictEqual(feedback.sentiment, 1.0);
    });

    it("detects explicit negative feedback", () => {
      const feedback = analyzeUserFeedback(
        "that's wrong, undo those changes",
        [],
        false,
      );
      assert.strictEqual(feedback.type, "explicit_negative");
      assert.strictEqual(feedback.sentiment, 0.0);
    });

    it("detects implicit retry from similar prompt", () => {
      const previousPrompts = ["fix the authentication bug in login.ts"];
      const feedback = analyzeUserFeedback(
        "please fix the authentication bug in login.ts again",
        previousPrompts,
        true,
      );
      assert.strictEqual(feedback.type, "implicit_retry");
      assert.ok(feedback.sentiment < 0.5);
    });

    it("detects implicit continuation for new unrelated task", () => {
      const previousPrompts = ["fix the authentication bug"];
      const feedback = analyzeUserFeedback(
        "now add a new database migration for users",
        previousPrompts,
        true,
      );
      assert.strictEqual(feedback.type, "implicit_continuation");
      assert.ok(feedback.sentiment > 0.5);
    });

    it("returns neutral for ambiguous prompts", () => {
      const feedback = analyzeUserFeedback(
        "can you also update the README with these changes",
        [],
        false,
      );
      assert.strictEqual(feedback.type, "neutral");
      assert.strictEqual(feedback.sentiment, 0.5);
    });
  });

  describe("Tool Success Detection", () => {
    function determineToolSuccess(toolName: string, output: unknown): boolean {
      const outStr =
        typeof output === "string" ? output : JSON.stringify(output ?? "");

      if (
        /\b(error|failed|exception|denied|refused|cannot|unable)\b/i.test(
          outStr,
        )
      ) {
        if (!/\b(fix|fixing|found|check|looking)\b/i.test(outStr)) {
          return false;
        }
      }

      switch (toolName) {
        case "Bash":
          if (/exit code[:\s]+[1-9]/i.test(outStr)) return false;
          if (/command not found/i.test(outStr)) return false;
          break;
        case "Edit":
        case "Write":
          if (
            /\b(file not found|permission denied|no such file)\b/i.test(outStr)
          )
            return false;
          break;
        case "Read":
          if (/\b(file not found|does not exist|no such file)\b/i.test(outStr))
            return false;
          break;
      }

      return true;
    }

    it("detects Bash errors from exit code", () => {
      assert.strictEqual(determineToolSuccess("Bash", "exit code: 1"), false);
      assert.strictEqual(
        determineToolSuccess("Bash", "command not found: xyz"),
        false,
      );
      assert.strictEqual(determineToolSuccess("Bash", "Success!"), true);
    });

    it("detects Edit/Write failures", () => {
      assert.strictEqual(determineToolSuccess("Edit", "file not found"), false);
      assert.strictEqual(
        determineToolSuccess("Write", "permission denied"),
        false,
      );
      assert.strictEqual(
        determineToolSuccess("Edit", "File updated successfully"),
        true,
      );
    });

    it("detects Read failures", () => {
      assert.strictEqual(
        determineToolSuccess("Read", "file does not exist"),
        false,
      );
      assert.strictEqual(
        determineToolSuccess("Read", "contents of file..."),
        true,
      );
    });

    it("ignores errors in context of fixing", () => {
      assert.strictEqual(
        determineToolSuccess("Read", "Looking for the error in the code"),
        true,
      );
      assert.strictEqual(
        determineToolSuccess("Bash", "Fixing the failed test"),
        true,
      );
    });

    it("detects general error patterns", () => {
      assert.strictEqual(
        determineToolSuccess("Task", "Error: something went wrong"),
        false,
      );
      assert.strictEqual(
        determineToolSuccess("Task", "Operation completed"),
        true,
      );
    });
  });

  describe("Multi-Dimensional Outcome Scoring", () => {
    interface EnrichedToolCall {
      tool: string;
      input: Record<string, unknown>;
      output: unknown;
      timestamp: string;
      succeeded?: boolean;
      active_principles?: string[];
      prompt_index?: number;
    }

    interface SessionState {
      sessionId: string;
      startTime: string;
      prompts?: string[];
      injectedPrinciples?: string[];
      userFeedback?: UserFeedback[];
      toolCalls: EnrichedToolCall[];
    }

    function computeOutcomeSignals(state: SessionState): OutcomeSignals {
      const toolCalls = state.toolCalls || [];
      const userFeedback = state.userFeedback || [];

      const toolsWithSuccess = toolCalls.filter(
        (tc) => tc.succeeded !== undefined,
      );
      let tool_success_rate: number;
      if (toolsWithSuccess.length > 0) {
        tool_success_rate =
          toolsWithSuccess.filter((tc) => tc.succeeded).length /
          toolsWithSuccess.length;
      } else {
        const succeededTools = toolCalls.filter((tc) => {
          const out =
            typeof tc.output === "string"
              ? tc.output
              : JSON.stringify(tc.output);
          return !/error|failed/i.test(out);
        });
        tool_success_rate =
          toolCalls.length > 0 ? succeededTools.length / toolCalls.length : 1;
      }

      const error_count = toolCalls.filter((tc) => {
        if (tc.succeeded === false) return true;
        const out =
          typeof tc.output === "string" ? tc.output : JSON.stringify(tc.output);
        return /error|failed/i.test(out);
      }).length;

      const editTools = ["Edit", "Write", "NotebookEdit"];
      const edits = toolCalls.filter((tc) => editTools.includes(tc.tool));
      const made_edits = edits.length > 0;
      const edit_count = edits.length;

      const files = new Set<string>();
      for (const tc of edits) {
        const filePath =
          (tc.input?.file_path as string) || (tc.input?.path as string);
        if (filePath) files.add(filePath);
      }
      const files_touched = files.size;

      const avg_sentiment =
        userFeedback.length > 0
          ? userFeedback.reduce((sum, f) => sum + f.sentiment, 0) /
            userFeedback.length
          : 0.5;

      return {
        tool_success_rate,
        error_count,
        made_edits,
        edit_count,
        files_touched,
        user_feedback: userFeedback,
        avg_sentiment,
        session_continued: toolCalls.length > 0,
        prompt_count: state.prompts?.length || 0,
      };
    }

    it("computes tool success rate from succeeded field", () => {
      const state: SessionState = {
        sessionId: "test",
        startTime: new Date().toISOString(),
        toolCalls: [
          {
            tool: "Read",
            input: {},
            output: "ok",
            timestamp: "",
            succeeded: true,
          },
          {
            tool: "Edit",
            input: {},
            output: "ok",
            timestamp: "",
            succeeded: true,
          },
          {
            tool: "Bash",
            input: {},
            output: "error",
            timestamp: "",
            succeeded: false,
          },
        ],
      };
      const signals = computeOutcomeSignals(state);
      assert.strictEqual(signals.tool_success_rate, 2 / 3);
      assert.strictEqual(signals.error_count, 1);
    });

    it("tracks edit metrics", () => {
      const state: SessionState = {
        sessionId: "test",
        startTime: new Date().toISOString(),
        toolCalls: [
          {
            tool: "Edit",
            input: { file_path: "/a.ts" },
            output: "ok",
            timestamp: "",
            succeeded: true,
          },
          {
            tool: "Write",
            input: { file_path: "/b.ts" },
            output: "ok",
            timestamp: "",
            succeeded: true,
          },
          {
            tool: "Edit",
            input: { file_path: "/a.ts" },
            output: "ok",
            timestamp: "",
            succeeded: true,
          },
        ],
      };
      const signals = computeOutcomeSignals(state);
      assert.strictEqual(signals.made_edits, true);
      assert.strictEqual(signals.edit_count, 3);
      assert.strictEqual(signals.files_touched, 2); // /a.ts and /b.ts
    });

    it("computes average user sentiment", () => {
      const state: SessionState = {
        sessionId: "test",
        startTime: new Date().toISOString(),
        toolCalls: [],
        userFeedback: [
          {
            sentiment: 1.0,
            type: "explicit_positive",
            confidence: 0.9,
            prompt_index: 0,
          },
          {
            sentiment: 0.7,
            type: "implicit_continuation",
            confidence: 0.6,
            prompt_index: 1,
          },
        ],
      };
      const signals = computeOutcomeSignals(state);
      assert.strictEqual(signals.avg_sentiment, 0.85);
    });

    it("defaults sentiment to 0.5 with no feedback", () => {
      const state: SessionState = {
        sessionId: "test",
        startTime: new Date().toISOString(),
        toolCalls: [],
      };
      const signals = computeOutcomeSignals(state);
      assert.strictEqual(signals.avg_sentiment, 0.5);
    });
  });

  describe("Principle Credit Assignment", () => {
    interface EnrichedToolCall {
      tool: string;
      input: Record<string, unknown>;
      output: unknown;
      timestamp: string;
      succeeded?: boolean;
      active_principles?: string[];
      prompt_index?: number;
    }

    interface SessionState {
      sessionId: string;
      startTime: string;
      prompts?: string[];
      injectedPrinciples?: string[];
      userFeedback?: UserFeedback[];
      toolCalls: EnrichedToolCall[];
    }

    interface PrincipleCredit {
      principle_id: string;
      credit: number;
      reasoning: string;
    }

    function calculatePrincipleCredits(
      state: SessionState,
      outcomeScore: number,
      userFeedback: UserFeedback[],
    ): PrincipleCredit[] {
      const credits: PrincipleCredit[] = [];
      const principleIds = state.injectedPrinciples || [];

      if (principleIds.length === 0) return credits;

      const principleStats = new Map<
        string,
        { succeeded: number; failed: number; total: number }
      >();
      for (const pId of principleIds) {
        principleStats.set(pId, { succeeded: 0, failed: 0, total: 0 });
      }

      for (const tc of state.toolCalls || []) {
        const activePrinciples = tc.active_principles || principleIds;
        for (const pId of activePrinciples) {
          const stats = principleStats.get(pId);
          if (stats) {
            stats.total++;
            if (tc.succeeded !== false) stats.succeeded++;
            else stats.failed++;
          }
        }
      }

      for (const pId of principleIds) {
        const stats = principleStats.get(pId);
        if (!stats) continue;
        const reasons: string[] = [];
        let credit = outcomeScore;

        if (stats.total > 0) {
          const principleToolRate = stats.succeeded / stats.total;
          credit = credit * 0.6 + principleToolRate * 0.4;
          reasons.push(`tools=${(principleToolRate * 100).toFixed(0)}%`);
        }

        if (userFeedback.length > 0) {
          const avgSentiment =
            userFeedback.reduce((s, f) => s + f.sentiment, 0) /
            userFeedback.length;
          credit = credit * 0.7 + avgSentiment * 0.3;
          reasons.push(`sentiment=${(avgSentiment * 100).toFixed(0)}%`);
        }

        credits.push({
          principle_id: pId,
          credit: Math.max(0, Math.min(1, credit)),
          reasoning: reasons.join(", ") || "base_outcome",
        });
      }

      return credits;
    }

    it("assigns credit based on tool success rate", () => {
      const state: SessionState = {
        sessionId: "test",
        startTime: new Date().toISOString(),
        injectedPrinciples: ["principle-1"],
        toolCalls: [
          {
            tool: "Edit",
            input: {},
            output: "ok",
            timestamp: "",
            succeeded: true,
            active_principles: ["principle-1"],
          },
          {
            tool: "Bash",
            input: {},
            output: "ok",
            timestamp: "",
            succeeded: true,
            active_principles: ["principle-1"],
          },
        ],
      };

      const credits = calculatePrincipleCredits(state, 0.7, []);
      assert.strictEqual(credits.length, 1);
      assert.strictEqual(credits[0].principle_id, "principle-1");
      // Base 0.7 * 0.6 + 1.0 * 0.4 = 0.42 + 0.4 = 0.82
      assert.ok(credits[0].credit > 0.8);
    });

    it("penalizes principles with failed tool calls", () => {
      const state: SessionState = {
        sessionId: "test",
        startTime: new Date().toISOString(),
        injectedPrinciples: ["principle-1"],
        toolCalls: [
          {
            tool: "Edit",
            input: {},
            output: "ok",
            timestamp: "",
            succeeded: false,
            active_principles: ["principle-1"],
          },
          {
            tool: "Bash",
            input: {},
            output: "ok",
            timestamp: "",
            succeeded: false,
            active_principles: ["principle-1"],
          },
        ],
      };

      const credits = calculatePrincipleCredits(state, 0.7, []);
      // Base 0.7 * 0.6 + 0.0 * 0.4 = 0.42
      assert.ok(credits[0].credit < 0.5);
    });

    it("boosts credit with positive user feedback", () => {
      const state: SessionState = {
        sessionId: "test",
        startTime: new Date().toISOString(),
        injectedPrinciples: ["principle-1"],
        toolCalls: [],
      };

      const feedback: UserFeedback[] = [
        {
          sentiment: 1.0,
          type: "explicit_positive",
          confidence: 0.9,
          prompt_index: 0,
        },
      ];

      const credits = calculatePrincipleCredits(state, 0.5, feedback);
      // Base 0.5 * 0.7 + 1.0 * 0.3 = 0.35 + 0.3 = 0.65
      assert.ok(credits[0].credit > 0.6);
    });

    it("reduces credit with negative user feedback", () => {
      const state: SessionState = {
        sessionId: "test",
        startTime: new Date().toISOString(),
        injectedPrinciples: ["principle-1"],
        toolCalls: [],
      };

      const feedback: UserFeedback[] = [
        {
          sentiment: 0.0,
          type: "explicit_negative",
          confidence: 0.9,
          prompt_index: 0,
        },
      ];

      const credits = calculatePrincipleCredits(state, 0.5, feedback);
      // Base 0.5 * 0.7 + 0.0 * 0.3 = 0.35
      assert.ok(credits[0].credit < 0.4);
    });

    it("handles multiple principles with different active contexts", () => {
      const state: SessionState = {
        sessionId: "test",
        startTime: new Date().toISOString(),
        injectedPrinciples: ["principle-1", "principle-2"],
        toolCalls: [
          {
            tool: "Edit",
            input: {},
            output: "ok",
            timestamp: "",
            succeeded: true,
            active_principles: ["principle-1"],
          },
          {
            tool: "Bash",
            input: {},
            output: "error",
            timestamp: "",
            succeeded: false,
            active_principles: ["principle-2"],
          },
        ],
      };

      const credits = calculatePrincipleCredits(state, 0.5, []);

      const p1Credit = credits.find((c) => c.principle_id === "principle-1");
      const p2Credit = credits.find((c) => c.principle_id === "principle-2");

      assert.ok(p1Credit);
      assert.ok(p2Credit);
      // principle-1 should have higher credit (100% tool success)
      // principle-2 should have lower credit (0% tool success)
      assert.ok(p1Credit.credit > p2Credit.credit);
    });
  });
});
