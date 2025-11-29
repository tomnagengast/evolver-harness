/**
 * Reasoning Contract and Tool Definitions for Online Orchestration
 *
 * This module defines the system prompt additions and tool schemas
 * that augment Claude Code with experience base capabilities.
 */

/**
 * The core reasoning contract - added to Claude's system prompt
 * to enable experience-based reasoning during live sessions
 */
export const EVOLVER_SYSTEM_PROMPT = `
# Experience-Based Reasoning Contract

You have access to an experience base containing learned principles and past traces.
These principles represent distilled knowledge from successful problem-solving episodes.

## Using the Experience Base

When working on a task:

1. **Search for relevant experience** using the \`search_experience\` tool
   - Query by natural language (semantic search)
   - Filter by tags, outcome status, or time range
   - Retrieve both principles and similar past traces

2. **Apply retrieved principles** to guide your approach
   - Consider principles as strong priors, not absolute rules
   - Adapt principles to the current context
   - Favor principles with higher scores (success_count / use_count)

3. **Log your trajectory** using the \`log_trajectory\` tool
   - Mark decision points and reasoning steps
   - Link to principles that influenced your choices
   - This helps improve future principle extraction

## When to Search Experience

Search the experience base when:
- Starting a new task (to find relevant strategies)
- Encountering uncertainty (to learn from similar situations)
- After a failure (to find alternative approaches)
- Before making significant decisions (to validate your reasoning)

## Reasoning with Principles

When a principle is retrieved:
- **Evaluate relevance**: Does it apply to the current situation?
- **Assess confidence**: What's the principle's score (success_count + 1) / (use_count + 2)?
- **Adapt strategically**: How should the principle be modified for this context?
- **Track usage**: Note which principles influenced your decisions

## Principle Scores

Principles are scored using Bayesian statistics:
- Score = (success_count + 1) / (use_count + 2)
- Higher scores indicate more reliable principles
- Scores near 0.5 indicate uncertain or untested principles
- Scores near 1.0 indicate highly reliable principles

## Meta-Learning

Your usage of principles updates their scores:
- When you use a principle and succeed, its score increases
- When you use a principle and fail, its score decreases
- This creates a feedback loop for continuous improvement

Remember: The experience base augments but does not replace your reasoning.
Always apply critical thinking and adapt principles to the current context.
`.trim();

/**
 * Tool schema for searching the experience base
 * This tool is injected into Claude Code's tool registry
 */
export const SEARCH_EXPERIENCE_TOOL_SCHEMA = {
  name: "search_experience",
  description: `Search the experience base for relevant principles and past traces.

Use this tool to find:
- Learned principles that apply to your current task
- Similar past traces that solved related problems
- Strategic guidance based on historical success

Supports semantic search (natural language queries) and structured filtering by tags,
outcome status, model, time range, and minimum principle score.

Returns ranked results with similarity scores and relevance explanations.`,

  input_schema: {
    type: "object" as const,
    properties: {
      query_text: {
        type: "string",
        description:
          'Natural language query describing what you\'re looking for. Examples: "authentication bug fix", "react performance optimization", "database migration strategy"',
      },
      tags: {
        type: "array",
        description:
          'Filter by tags. Returns items matching ANY of these tags. Examples: ["authentication", "security"], ["performance", "react"]',
        items: {
          type: "string",
        },
      },
      search_mode: {
        type: "string",
        enum: ["principles", "traces", "both"],
        description:
          'What to search for: "principles" (learned knowledge), "traces" (past episodes), or "both" (default: "both")',
      },
      limit: {
        type: "number",
        description:
          "Maximum number of results to return (default: 10, max: 50)",
      },
      min_similarity: {
        type: "number",
        description:
          "Minimum similarity score threshold (0-1). Only returns results with similarity >= this value (default: 0.7)",
      },
      min_principle_score: {
        type: "number",
        description:
          "Minimum principle quality score threshold (0-1). Filters out low-quality principles (default: 0.5)",
      },
      outcome_filter: {
        type: "array",
        description:
          'Filter traces by outcome status: "success", "failure", or "partial" (only applies to trace search)',
        items: {
          type: "string",
          enum: ["success", "failure", "partial"],
        },
      },
      time_range: {
        type: "object",
        description: "Filter by time range (ISO 8601 timestamps)",
        properties: {
          start: {
            type: "string",
            description: "Start of time range (ISO 8601)",
          },
          end: {
            type: "string",
            description: "End of time range (ISO 8601)",
          },
        },
        required: ["start", "end"],
      },
    },
    required: [],
  },
};

/**
 * Tool schema for logging trajectory markers
 * This tool allows Claude to explicitly mark reasoning steps for trace analysis
 */
export const LOG_TRAJECTORY_TOOL_SCHEMA = {
  name: "log_trajectory",
  description: `Log a decision point or reasoning step in your current trajectory.

Use this tool to explicitly mark:
- Key decisions and their rationale
- Application of retrieved principles
- Strategic pivots or course corrections
- Observations about what's working or not

These markers enrich the trace and help improve future principle extraction.
This is optional - only use when you want to explicitly highlight important reasoning steps.`,

  input_schema: {
    type: "object" as const,
    properties: {
      thought: {
        type: "string",
        description:
          "The reasoning step or observation to log. Be specific about what you decided and why.",
      },
      principles_used: {
        type: "array",
        description:
          "IDs of principles that influenced this decision (if any). Helps track principle usage.",
        items: {
          type: "string",
        },
      },
      decision_type: {
        type: "string",
        enum: ["approach", "pivot", "validation", "observation"],
        description:
          'Type of decision: "approach" (choosing a strategy), "pivot" (changing strategy), "validation" (confirming approach), "observation" (noting a result)',
      },
      context: {
        type: "object",
        description: "Optional structured context about the decision point",
      },
    },
    required: ["thought"],
  },
};

/**
 * Combined tool schemas for easy registration
 */
export const EVOLVER_TOOL_SCHEMAS = [
  SEARCH_EXPERIENCE_TOOL_SCHEMA,
  LOG_TRAJECTORY_TOOL_SCHEMA,
];

/**
 * Default configuration for experience base queries
 */
export const DEFAULT_SEARCH_CONFIG = {
  limit: 10,
  maxLimit: 50,
  minSimilarity: 0.7,
  minPrincipleScore: 0.5,
  defaultSearchMode: "both" as const,
};

/**
 * Format a principle for display in tool output
 */
export function formatPrincipleForDisplay(principle: {
  id: string;
  text: string;
  tags: string[];
  use_count: number;
  success_count: number;
}): string {
  const score = (principle.success_count + 1) / (principle.use_count + 2);
  const confidence = score > 0.8 ? "HIGH" : score > 0.6 ? "MEDIUM" : "LOW";

  return `
[Principle ${principle.id}]
Score: ${score.toFixed(3)} (${confidence} confidence)
Usage: ${principle.use_count} times, ${principle.success_count} successes
Tags: ${principle.tags.join(", ")}

${principle.text}
`.trim();
}

/**
 * Format a trace for display in tool output
 */
export function formatTraceForDisplay(trace: {
  id: string;
  task_summary: string;
  problem_description: string;
  final_answer: string;
  outcome: { status: string; score: number };
  tool_calls: Array<{ tool: string }>;
  tags?: string[];
}): string {
  return `
[Trace ${trace.id}]
Outcome: ${trace.outcome.status.toUpperCase()} (score: ${trace.outcome.score.toFixed(2)})
Task: ${trace.task_summary}
Problem: ${trace.problem_description}
Tools used: ${trace.tool_calls.map((tc) => tc.tool).join(", ")}
${trace.tags ? `Tags: ${trace.tags.join(", ")}` : ""}

Solution: ${trace.final_answer.substring(0, 200)}${trace.final_answer.length > 200 ? "..." : ""}
`.trim();
}

