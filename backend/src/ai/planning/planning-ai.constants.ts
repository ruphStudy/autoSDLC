// Application-owned DI token. Business services depend on this, never on
// OpenAIPlanningProvider directly, so swapping/adding providers later never
// touches ProjectAnalysisService et al. — only this binding.
export const PLANNING_AI_PROVIDER = Symbol('PLANNING_AI_PROVIDER');

// Exists for observability/logging/future routing, not to pre-build every
// workflow. Sprint 4+ add real callers for the entries below as each
// workflow is implemented; GENERAL_PLANNING covers anything else (health
// checks, diagnostics, ad-hoc structured calls).
export enum PlanningOperation {
  PROJECT_ANALYSIS = 'PROJECT_ANALYSIS',
  ARCHITECTURE_GENERATION = 'ARCHITECTURE_GENERATION',
  SPRINT_PLANNING = 'SPRINT_PLANNING',
  TASK_INSTRUCTION = 'TASK_INSTRUCTION',
  SPRINT_REVIEW = 'SPRINT_REVIEW',
  GENERAL_PLANNING = 'GENERAL_PLANNING',
}
