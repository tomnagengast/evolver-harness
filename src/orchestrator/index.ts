/**
 * Orchestrator Module - Experience-Augmented Session Management
 *
 * This module provides the online orchestration layer that wraps Claude Code
 * sessions with experience base context.
 */

export { EvolverOrchestrator } from './orchestrator.js';
export type {
  OrchestratorConfig,
  SessionContext,
  SearchExperienceResult,
} from './orchestrator.js';

export {
  EVOLVER_SYSTEM_PROMPT,
  SEARCH_EXPERIENCE_TOOL_SCHEMA,
  LOG_TRAJECTORY_TOOL_SCHEMA,
  EVOLVER_TOOL_SCHEMAS,
  DEFAULT_SEARCH_CONFIG,
  formatPrincipleForDisplay,
  formatTraceForDisplay,
} from './contract.js';

export {
  ClaudeMdInjector,
  injectPrinciples,
  removeExperienceSection,
  restoreClaudeMd,
  EXPERIENCE_SECTION_TEMPLATE,
} from './claude-md-injector.js';
export type { InjectorConfig } from './claude-md-injector.js';

