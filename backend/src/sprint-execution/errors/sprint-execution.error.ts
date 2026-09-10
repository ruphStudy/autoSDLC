// Normalized domain error codes for the Sprint Orchestrator — mirrors the
// TaskExecutionError/TaskValidationError pattern (Sprints 12/13): one enum
// doubles as both eligibility reasons (getEligibility) and thrown errors
// (run()/resume()), so the two can never drift apart.
export enum SprintExecutionErrorCode {
  SPRINT_NOT_FOUND = 'SPRINT_NOT_FOUND',
  EXECUTION_NOT_FOUND = 'EXECUTION_NOT_FOUND',

  PROJECT_ARCHIVED = 'PROJECT_ARCHIVED',
  DEVELOPMENT_NOT_APPROVED = 'DEVELOPMENT_NOT_APPROVED',
  SPRINT_NOT_IN_CURRENT_PLAN = 'SPRINT_NOT_IN_CURRENT_PLAN',

  SPRINT_ALREADY_PASSED = 'SPRINT_ALREADY_PASSED',
  SPRINT_ALREADY_ACTIVE = 'SPRINT_ALREADY_ACTIVE',
  OTHER_SPRINT_ACTIVE = 'OTHER_SPRINT_ACTIVE',
  SPRINT_DEPENDENCY_NOT_PASSED = 'SPRINT_DEPENDENCY_NOT_PASSED',
  // Sprint 16: a prerequisite Sprint mechanically PASSED but has not yet
  // been formally ACCEPTED (Sprint Acceptance Review) — a distinct,
  // actionable state from "hasn't finished running yet" (item 58/59).
  SPRINT_DEPENDENCY_NOT_ACCEPTED = 'SPRINT_DEPENDENCY_NOT_ACCEPTED',

  WORKSPACE_NOT_READY = 'WORKSPACE_NOT_READY',
  WRONG_BRANCH = 'WRONG_BRANCH',
  WORKSPACE_DIRTY = 'WORKSPACE_DIRTY',

  // No Task in the Sprint is currently eligible to run, but not every Task
  // is PASSED either — a dependency deadlock, a FAILED/BLOCKED Task with no
  // recovery path yet, or an inconsistent status (item 18/19).
  NO_RUNNABLE_TASKS = 'NO_RUNNABLE_TASKS',
  // A Task reported PASSED but left the workspace dirty (item 50) — the
  // orchestrator must never run the next Task over unreviewed leftovers.
  WORKSPACE_NOT_CLEAN_AFTER_TASK = 'WORKSPACE_NOT_CLEAN_AFTER_TASK',
  // A Task did not reach PASSED (execution FAILED/CANCELLED, or validation
  // FAILED/CANCELLED) — the Sprint stops advancing (item 30/31).
  TASK_NOT_PASSED = 'TASK_NOT_PASSED',

  CANCELLED_BEFORE_START = 'CANCELLED_BEFORE_START',
  ENQUEUE_FAILED = 'ENQUEUE_FAILED',
  // A previous orchestration attempt's background Job ended without this
  // service's own loop reporting a terminal outcome (worker crash/restart)
  // — see reconcileSprintExecution.
  ORPHANED_SPRINT_EXECUTION = 'ORPHANED_SPRINT_EXECUTION',

  NOT_PAUSABLE = 'NOT_PAUSABLE',
  NOT_RESUMABLE = 'NOT_RESUMABLE',

  UNKNOWN_ERROR = 'UNKNOWN_ERROR',
}

export interface SprintExecutionErrorOptions {
  code: SprintExecutionErrorCode;
  message: string;
  cause?: unknown;
}

export class SprintExecutionError extends Error {
  readonly code: SprintExecutionErrorCode;
  readonly cause?: unknown;

  constructor(options: SprintExecutionErrorOptions) {
    super(options.message);
    this.name = 'SprintExecutionError';
    this.code = options.code;
    this.cause = options.cause;
  }
}
