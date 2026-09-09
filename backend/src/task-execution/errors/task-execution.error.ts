// Normalized domain error codes for the Single Task Orchestrator — mirrors
// the GitError / CodingAgentError / TaskInstructionError pattern used
// elsewhere in this codebase. This one enum deliberately doubles as both
// "why can't this Task run" (TaskExecutionService.getEligibility) and "why
// did this attempt to run it fail" (thrown by run()/execute()) — the two
// concerns share one vocabulary on purpose, so eligibility reporting and
// enforcement can never silently drift apart.
export enum TaskExecutionErrorCode {
  TASK_NOT_FOUND = 'TASK_NOT_FOUND',
  EXECUTION_NOT_FOUND = 'EXECUTION_NOT_FOUND',

  PROJECT_ARCHIVED = 'PROJECT_ARCHIVED',
  // Covers the whole Sprint 7 assertDevelopmentApproved gate (Analysis +
  // Architecture + Sprint Plan approved, and Start Development explicitly
  // approved) — that gate is a single all-or-nothing check, so there is no
  // clean way to further decompose "project not approved" from "plan not
  // approved" without inventing logic Sprint 7 doesn't expose.
  DEVELOPMENT_NOT_APPROVED = 'DEVELOPMENT_NOT_APPROVED',
  TASK_NOT_IN_CURRENT_PLAN = 'TASK_NOT_IN_CURRENT_PLAN',

  TASK_ALREADY_PASSED = 'TASK_ALREADY_PASSED',
  TASK_RUNNING = 'TASK_RUNNING',
  TASK_REVIEWING = 'TASK_REVIEWING',
  TASK_FAILED_PREVIOUSLY = 'TASK_FAILED_PREVIOUSLY',
  TASK_BLOCKED = 'TASK_BLOCKED',

  DEPENDENCY_NOT_PASSED = 'DEPENDENCY_NOT_PASSED',
  SPRINT_BLOCKED = 'SPRINT_BLOCKED',
  ACTIVE_EXECUTION = 'ACTIVE_EXECUTION',

  WORKSPACE_NOT_READY = 'WORKSPACE_NOT_READY',
  WORKSPACE_DIRTY = 'WORKSPACE_DIRTY',
  WRONG_BRANCH = 'WRONG_BRANCH',

  // The repository moved between fetching/generating the Task instruction
  // and the point execution was about to hand it to the coding agent — even
  // after one regeneration attempt. Never execute against a stale
  // instruction (see TaskExecutionService.getFreshInstructionOrThrow).
  REPOSITORY_STATE_CHANGED = 'REPOSITORY_STATE_CHANGED',

  CANCELLED_BEFORE_START = 'CANCELLED_BEFORE_START',
  ENQUEUE_FAILED = 'ENQUEUE_FAILED',
  // A previous attempt's background Job ended (crashed/was recovered by
  // stale-lock cleanup) without this service's own bookkeeping ever
  // running, so the Task would otherwise be stuck RUNNING forever — see
  // TaskExecutionService.reconcileOrphanedExecution.
  ORPHANED_EXECUTION = 'ORPHANED_EXECUTION',
  INSTRUCTION_GENERATION_FAILED = 'INSTRUCTION_GENERATION_FAILED',
  PROVIDER_ERROR = 'PROVIDER_ERROR',
  UNKNOWN_ERROR = 'UNKNOWN_ERROR',
}

export interface TaskExecutionErrorOptions {
  code: TaskExecutionErrorCode;
  message: string;
  cause?: unknown;
}

export class TaskExecutionError extends Error {
  readonly code: TaskExecutionErrorCode;
  readonly cause?: unknown;

  constructor(options: TaskExecutionErrorOptions) {
    super(options.message);
    this.name = 'TaskExecutionError';
    this.code = options.code;
    this.cause = options.cause;
  }
}
