/**
 * Orchestrator Module - Experience-Augmented Session Management
 *
 * This module provides the online orchestration layer that wraps Claude Code
 * sessions with experience base context.
 */

export type { InjectorConfig } from "./claude-md-injector.js";
export {
  ClaudeMdInjector,
  EXPERIENCE_SECTION_TEMPLATE,
  injectPrinciples,
  removeExperienceSection,
  restoreClaudeMd,
} from "./claude-md-injector.js";

export {
  DEFAULT_SEARCH_CONFIG,
  EVOLVER_SYSTEM_PROMPT,
  EVOLVER_TOOL_SCHEMAS,
  formatPrincipleForDisplay,
  formatTraceForDisplay,
  LOG_TRAJECTORY_TOOL_SCHEMA,
  SEARCH_EXPERIENCE_TOOL_SCHEMA,
} from "./contract.js";
export type {
  OrchestratorConfig,
  SearchExperienceResult,
  SessionContext,
} from "./orchestrator.js";
export { EvolverOrchestrator } from "./orchestrator.js";

