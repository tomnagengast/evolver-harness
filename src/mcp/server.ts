#!/usr/bin/env bun
/**
 * Evolver MCP Server
 *
 * Provides on-demand principle retrieval and feedback tools for Claude.
 * Enables mid-session access to the experience base.
 */

import { homedir } from "node:os";
import { join } from "node:path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { ExpBaseStorage } from "../storage/expbase.js";
import { calculatePrincipleScore } from "../types.js";

const expandTilde = (p: string) =>
  p.startsWith("~/") ? join(homedir(), p.slice(2)) : p;

const DB_PATH = expandTilde(
  process.env.EVOLVER_DB_PATH || join(homedir(), ".evolver", "expbase.db"),
);
const STATE_DIR = expandTilde(
  process.env.EVOLVER_STATE_DIR || join(homedir(), ".evolver", "sessions"),
);

/** Get session-specific state file path */
const getStateFile = (sessionId: string) =>
  join(STATE_DIR, `${sessionId}.json`);

interface SessionState {
  sessionId: string;
  startTime?: string;
  injectedPrinciples: string[];
  exploratoryPrinciples?: string[];
  contextTags?: string[];
}

const server = new Server(
  { name: "evolver", version: "1.0.0" },
  { capabilities: { tools: {}, resources: {} } },
);

/** Format principles for display */
function formatPrinciples(
  principles: Array<{
    id: string;
    text: string;
    tags: string[];
    score: number;
    use_count: number;
    success_rate: number | null;
    is_exploratory?: boolean;
  }>,
): string {
  if (principles.length === 0) {
    return "No principles found matching your query.";
  }

  const lines: string[] = ["# Retrieved Principles\n"];

  for (const p of principles) {
    const exploratoryLabel = p.is_exploratory ? " (exploring)" : "";
    const successRate =
      p.success_rate !== null
        ? ` | success: ${(p.success_rate * 100).toFixed(0)}%`
        : "";
    lines.push(`## [${p.id}]${exploratoryLabel}`);
    lines.push(
      `Score: ${p.score.toFixed(2)} | Uses: ${p.use_count}${successRate}`,
    );
    lines.push(`Tags: ${p.tags.join(", ")}`);
    lines.push("");
    lines.push(p.text);
    lines.push("\n---\n");
  }

  return lines.join("\n");
}

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "search_principles",
      description:
        "Search for relevant principles based on your current task or problem. Use this when you need guidance on a specific topic or want to explore new principles.",
      inputSchema: {
        type: "object" as const,
        properties: {
          query: {
            type: "string",
            description:
              "Natural language description of your situation or task",
          },
          tags: {
            type: "array",
            items: { type: "string" },
            description:
              "Filter by specific tags (e.g., ['typescript', 'testing'])",
          },
          include_exploration: {
            type: "boolean",
            description:
              "Include some untested/new principles for exploration (default: true)",
          },
          limit: {
            type: "number",
            description: "Maximum number of principles to return (default: 5)",
          },
        },
      },
    },
    {
      name: "rate_principle",
      description:
        "Provide feedback on whether a principle was helpful for your current task. This improves future recommendations.",
      inputSchema: {
        type: "object" as const,
        properties: {
          principle_id: {
            type: "string",
            description: "The ID of the principle to rate",
          },
          was_helpful: {
            type: "boolean",
            description: "Whether the principle was helpful",
          },
          context: {
            type: "string",
            description: "Brief note on why (helps improve the system)",
          },
        },
        required: ["principle_id", "was_helpful"],
      },
    },
    {
      name: "list_tags",
      description:
        "List all available tags in the experience base. Useful for discovering what categories of principles exist.",
      inputSchema: {
        type: "object" as const,
        properties: {},
      },
    },
    {
      name: "list_loaded_principles",
      description:
        "List all principles that were loaded into the current session at startup. Shows which principles are currently active and available for guidance.",
      inputSchema: {
        type: "object" as const,
        properties: {
          session_id: {
            type: "string",
            description:
              "The session ID to look up. If not provided, uses EVOLVER_SESSION_ID env var.",
          },
        },
      },
    },
  ],
}));

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name === "search_principles") {
    try {
      const query = args?.query as string | undefined;
      const tags = args?.tags as string[] | undefined;
      const includeExploration = (args?.include_exploration as boolean) ?? true;
      const limit = (args?.limit as number) ?? 5;

      const storage = new ExpBaseStorage({ dbPath: DB_PATH });

      // Core retrieval by tags with lower threshold for on-demand
      let principles = storage.searchPrinciples({
        tags,
        limit: limit * 2,
        min_principle_score: 0.3,
      });

      // If query provided, do simple keyword matching on principle text
      if (query) {
        const queryWords = query.toLowerCase().split(/\s+/);
        principles = principles.filter((p) => {
          const text = p.text.toLowerCase();
          return queryWords.some((word) => text.includes(word));
        });
      }

      // Add exploration if requested
      let exploratoryIds = new Set<string>();
      if (includeExploration) {
        const exploratory = storage.getExploratoryPrinciples(2);
        exploratoryIds = new Set(exploratory.map((p) => p.id));
        // Add exploratory principles that aren't already in results
        const mainIds = new Set(principles.map((p) => p.id));
        const newExploratory = exploratory.filter((p) => !mainIds.has(p.id));
        principles = [...principles, ...newExploratory];
      }

      storage.close();

      // Format for output
      const formatted = principles.slice(0, limit).map((p) => ({
        id: p.id,
        text: p.text,
        tags: p.tags,
        score: calculatePrincipleScore(p),
        use_count: p.use_count,
        success_rate: p.use_count > 0 ? p.success_count / p.use_count : null,
        is_exploratory: exploratoryIds.has(p.id),
      }));

      return {
        content: [{ type: "text" as const, text: formatPrinciples(formatted) }],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error searching principles: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }

  if (name === "rate_principle") {
    try {
      const principleId = args?.principle_id as string;
      const wasHelpful = args?.was_helpful as boolean;
      const context = args?.context as string | undefined;

      if (!principleId) {
        return {
          content: [
            { type: "text" as const, text: "principle_id is required" },
          ],
          isError: true,
        };
      }

      const storage = new ExpBaseStorage({ dbPath: DB_PATH });

      // Check if principle exists
      const principle = storage.getPrinciple(principleId);
      if (!principle) {
        storage.close();
        return {
          content: [
            {
              type: "text" as const,
              text: `Principle with ID "${principleId}" not found.`,
            },
          ],
          isError: true,
        };
      }

      storage.recordUsage(principleId, undefined, wasHelpful);
      storage.close();

      const feedback = wasHelpful ? "positive" : "negative";
      const contextNote = context ? ` Context: ${context}` : "";

      return {
        content: [
          {
            type: "text" as const,
            text: `Recorded ${feedback} feedback for principle [${principleId}].${contextNote}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error recording feedback: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }

  if (name === "list_tags") {
    try {
      const storage = new ExpBaseStorage({ dbPath: DB_PATH });
      const stats = storage.getStats();
      storage.close();

      const tags = stats.top_tags || [];
      if (tags.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: "No tags found in the experience base.",
            },
          ],
        };
      }

      const lines = ["# Available Tags\n"];
      for (const { tag, count } of tags) {
        lines.push(`- **${tag}** (${count} principles)`);
      }

      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error listing tags: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }

  if (name === "list_loaded_principles") {
    try {
      const sessionId =
        (args?.session_id as string) || process.env.EVOLVER_SESSION_ID;

      if (!sessionId) {
        return {
          content: [
            {
              type: "text" as const,
              text: "No session ID provided and EVOLVER_SESSION_ID not set. Cannot determine which principles are loaded.",
            },
          ],
          isError: true,
        };
      }

      const stateFile = Bun.file(getStateFile(sessionId));
      if (!(await stateFile.exists())) {
        return {
          content: [
            {
              type: "text" as const,
              text: `No session state found for session "${sessionId}". The session may not have been started with Evolver hooks.`,
            },
          ],
          isError: true,
        };
      }

      const state: SessionState = await stateFile.json();
      const principleIds = state.injectedPrinciples || [];

      if (principleIds.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: `# Loaded Principles\n\nNo principles were loaded for session ${sessionId}.`,
            },
          ],
        };
      }

      // Fetch full principle details from DB
      const storage = new ExpBaseStorage({ dbPath: DB_PATH });
      const exploratoryIds = new Set(state.exploratoryPrinciples || []);

      const principles = principleIds
        .map((id) => {
          const p = storage.getPrinciple(id);
          if (!p) return null;
          return {
            id: p.id,
            text: p.text,
            tags: p.tags,
            score: calculatePrincipleScore(p),
            use_count: p.use_count,
            success_rate:
              p.use_count > 0 ? p.success_count / p.use_count : null,
            is_exploratory: exploratoryIds.has(p.id),
          };
        })
        .filter(Boolean) as Array<{
        id: string;
        text: string;
        tags: string[];
        score: number;
        use_count: number;
        success_rate: number | null;
        is_exploratory: boolean;
      }>;

      storage.close();

      const lines = [
        "# Loaded Principles",
        "",
        `Session: ${sessionId}`,
        `Total: ${principles.length} principles`,
        "",
      ];

      if (state.contextTags && state.contextTags.length > 0) {
        lines.push(`Context tags: ${state.contextTags.join(", ")}`, "");
      }

      lines.push("---\n");
      lines.push(formatPrinciples(principles));

      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error listing loaded principles: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }

  return {
    content: [{ type: "text" as const, text: `Unknown tool: ${name}` }],
    isError: true,
  };
});

// List resources
server.setRequestHandler(ListResourcesRequestSchema, async () => ({
  resources: [
    {
      uri: "evolver://stats",
      name: "Experience Base Statistics",
      description: "View statistics about the Evolver experience base",
      mimeType: "text/markdown",
    },
  ],
}));

// Read resource
server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const { uri } = request.params;

  if (uri === "evolver://stats") {
    try {
      const storage = new ExpBaseStorage({ dbPath: DB_PATH });
      const stats = storage.getStats();
      storage.close();

      const lines = [
        "# Evolver Experience Base Statistics\n",
        `- **Principles**: ${stats.principle_count}`,
        `- **Traces**: ${stats.trace_count}`,
        `- **Avg Principle Score**: ${stats.avg_principle_score.toFixed(2)}`,
      ];

      if (stats.score_distribution) {
        lines.push("\n## Score Distribution");
        lines.push(`- Min: ${stats.score_distribution.min.toFixed(2)}`);
        lines.push(`- Median: ${stats.score_distribution.median.toFixed(2)}`);
        lines.push(`- Max: ${stats.score_distribution.max.toFixed(2)}`);
      }

      if (stats.top_tags && stats.top_tags.length > 0) {
        lines.push("\n## Top Tags");
        for (const { tag, count } of stats.top_tags.slice(0, 5)) {
          lines.push(`- ${tag}: ${count}`);
        }
      }

      return {
        contents: [{ uri, text: lines.join("\n"), mimeType: "text/markdown" }],
      };
    } catch (error) {
      return {
        contents: [
          {
            uri,
            text: `Error getting stats: ${error instanceof Error ? error.message : String(error)}`,
            mimeType: "text/plain",
          },
        ],
      };
    }
  }

  return {
    contents: [
      { uri, text: `Unknown resource: ${uri}`, mimeType: "text/plain" },
    ],
  };
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
