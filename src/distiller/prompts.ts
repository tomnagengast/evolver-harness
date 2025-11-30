/**
 * Distillation prompts for extracting principles from traces
 *
 * Based on the EvolveR paper's distillation methodology:
 * - Classify trace success/failure
 * - Extract actionable "When X, do Y" principles
 * - Generate semantic triples and tags
 * - Merge similar principles
 */

import type { Trace } from "../types.js";

/**
 * System prompt for the distillation process
 */
export const DISTILLATION_SYSTEM_PROMPT = `You are an expert at analyzing agent execution traces and extracting reusable strategic principles.

Your goal is to identify patterns in agent behavior that lead to success or failure, and distill them into actionable principles that can guide future agent executions.

Principles should be:
1. Specific and actionable - in the form "When X, do Y"
2. Generalizable - applicable to similar situations
3. Grounded in the trace - directly observable from the agent's behavior
4. Concise - typically 1-2 sentences

You will also extract:
- Semantic triples (subject-relation-object) that capture key relationships
- Tags for categorization (e.g., "error-handling", "planning", "tool-usage")`;

/**
 * Template for analyzing a single trace
 */
export function DISTILLATION_USER_PROMPT_TEMPLATE(trace: Trace): string {
  return `Analyze this agent execution trace and extract strategic principles.

## Trace Information

**Task Summary:** ${trace.task_summary}

**Problem Description:**
${trace.problem_description}

**Tool Calls:**
${trace.tool_calls
  .map(
    (tc, idx) => `${idx + 1}. ${tc.tool}(${JSON.stringify(tc.input, null, 2)})
   Output: ${JSON.stringify(tc.output, null, 2)}
   ${tc.error ? `Error: ${tc.error.message}` : ""}`,
  )
  .join("\n\n")}

**Intermediate Thoughts:**
${trace.intermediate_thoughts.map((thought, idx) => `${idx + 1}. ${thought}`).join("\n")}

**Final Answer:**
${trace.final_answer}

**Outcome:**
- Status: ${trace.outcome.status}
- Score: ${trace.outcome.score}
${trace.outcome.explanation ? `- Explanation: ${trace.outcome.explanation}` : ""}

**Duration:** ${trace.duration_ms}ms
**Model:** ${trace.model_used}

## Your Task

1. **Classify the trace:** Was this a success, failure, or partial success? Why?

2. **Extract 1-3 principles** from this trace in the format:
   - "When [situation/condition], [action/strategy]"
   - Each principle should be grounded in specific behaviors from the trace
   - Focus on the most impactful insights

3. **Generate semantic triples** (3-5 triples) that capture key relationships:
   - Format: {"subject": "...", "relation": "...", "object": "..."}
   - Example: {"subject": "agent", "relation": "used_tool", "object": "file_search"}

4. **Generate tags** (3-5 tags) for categorization:
   - Use lowercase with hyphens (e.g., "error-handling", "file-operations")
   - Common categories: tool-usage, planning, debugging, optimization, error-handling

Respond in JSON format:
{
  "classification": "success" | "failure" | "partial",
  "explanation": "Brief explanation of the outcome",
  "principles": [
    {
      "text": "When X, do Y",
      "confidence": 0.0-1.0,
      "rationale": "Why this principle is important"
    }
  ],
  "triples": [
    {"subject": "...", "relation": "...", "object": "..."}
  ],
  "tags": ["tag1", "tag2", "tag3"]
}`;
}

/**
 * Prompt for analyzing multiple traces together to find common patterns
 */
export function BATCH_DISTILLATION_PROMPT(traces: Trace[]): string {
  const traceSummaries = traces
    .map((trace, idx) => {
      return `### Trace ${idx + 1}
**Task:** ${trace.task_summary}
**Outcome:** ${trace.outcome.status} (score: ${trace.outcome.score})
**Tools Used:** ${trace.tool_calls.map((tc) => tc.tool).join(", ")}
**Duration:** ${trace.duration_ms}ms
${trace.outcome.explanation ? `**Note:** ${trace.outcome.explanation}` : ""}`;
    })
    .join("\n\n");

  return `Analyze these ${traces.length} agent execution traces and extract common strategic principles.

## Traces

${traceSummaries}

## Your Task

Look for patterns across these traces:
1. What strategies consistently led to success?
2. What mistakes or patterns led to failure?
3. Are there common tool usage patterns?
4. Are there common problem-solving approaches?

Extract 3-7 high-level principles that capture the most important patterns across these traces.
Each principle should be supported by multiple traces when possible.

Respond in JSON format:
{
  "principles": [
    {
      "text": "When X, do Y",
      "confidence": 0.0-1.0,
      "supporting_trace_ids": ["trace_id_1", "trace_id_2"],
      "rationale": "Why this principle emerges from these traces"
    }
  ],
  "triples": [
    {"subject": "...", "relation": "...", "object": "..."}
  ],
  "tags": ["tag1", "tag2", "tag3"]
}`;
}

/**
 * Prompt for deduplicating and merging similar principles
 */
export function DEDUPLICATION_PROMPT(
  newPrincipleText: string,
  existingPrinciples: Array<{ id: string; text: string; similarity: number }>,
): string {
  return `You are reviewing a newly extracted principle to determine if it should be merged with existing similar principles.

## New Principle
"${newPrincipleText}"

## Existing Similar Principles
${existingPrinciples.map((p, idx) => `${idx + 1}. [ID: ${p.id}] "${p.text}" (similarity: ${p.similarity.toFixed(3)})`).join("\n")}

## Your Task

Determine if the new principle should:
1. **Stand alone** - It's sufficiently different or adds unique value
2. **Merge with existing** - It's essentially the same as one of the existing principles
3. **Enhance existing** - It adds nuance or detail that should be incorporated

Consider:
- Semantic similarity (are they saying the same thing?)
- Scope (is one more general/specific than the other?)
- Context (do they apply to different situations?)
- Value (does the new principle add actionable insight?)

Respond in JSON format:
{
  "decision": "stand_alone" | "merge" | "enhance",
  "target_principle_id": "principle_id" (if merge or enhance),
  "reasoning": "Explanation of your decision",
  "merged_text": "Updated principle text" (if merge or enhance)
}`;
}

/**
 * Prompt for refining a principle based on multiple examples
 */
export function PRINCIPLE_REFINEMENT_PROMPT(
  principleText: string,
  exampleTraces: Array<{ trace: Trace; relevance: string }>,
): string {
  const examples = exampleTraces
    .map((ex, idx) => {
      return `### Example ${idx + 1}
**Task:** ${ex.trace.task_summary}
**Outcome:** ${ex.trace.outcome.status} (score: ${ex.trace.outcome.score})
**Relevance:** ${ex.relevance}
**Key Behaviors:** ${ex.trace.intermediate_thoughts.slice(0, 3).join("; ")}`;
    })
    .join("\n\n");

  return `Refine this principle based on multiple example traces where it was observed.

## Current Principle
"${principleText}"

## Supporting Examples
${examples}

## Your Task

Review the examples and refine the principle to:
1. Make it more precise based on observed patterns
2. Ensure it captures the common thread across examples
3. Maintain the "When X, do Y" format
4. Keep it concise and actionable

If the principle is already well-formed, you can return it unchanged.

Respond in JSON format:
{
  "refined_text": "Refined principle text",
  "changes_made": "Description of changes, or 'none' if unchanged",
  "confidence": 0.0-1.0
}`;
}
