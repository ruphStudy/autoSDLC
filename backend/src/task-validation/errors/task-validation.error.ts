// Normalized domain error codes for the Deterministic Validation Engine —
// mirrors the TaskExecutionError pattern (Sprint 12): this one enum doubles
// as both eligibility reasons (getEligibility) and thrown errors (run()),
// so the two can never drift apart.
export enum TaskValidationErrorCode {
  TASK_NOT_FOUND = 'TASK_NOT_FOUND',
  VALIDATION_NOT_FOUND = 'VALIDATION_NOT_FOUND',

  PROJECT_ARCHIVED = 'PROJECT_ARCHIVED',
  DEVELOPMENT_NOT_APPROVED = 'DEVELOPMENT_NOT_APPROVED',
  TASK_NOT_IN_CURRENT_PLAN = 'TASK_NOT_IN_CURRENT_PLAN',
  TASK_NOT_REVIEWING = 'TASK_NOT_REVIEWING',
  NO_SUCCESSFUL_EXECUTION = 'NO_SUCCESSFUL_EXECUTION',

  WORKSPACE_NOT_READY = 'WORKSPACE_NOT_READY',
  WRONG_BRANCH = 'WRONG_BRANCH',

  // The workspace is clean but the TaskExecution being validated recorded
  // real changed files (or vice versa) — something touched the workspace
  // between Sprint 12 finishing and validation starting.
  NO_EXPECTED_CHANGES = 'NO_EXPECTED_CHANGES',
  // The current Git status includes files outside the TaskExecution's own
  // recorded changed-file set.
  UNEXPECTED_WORKSPACE_CHANGES = 'UNEXPECTED_WORKSPACE_CHANGES',
  // Live HEAD no longer matches the TaskExecution's recorded start/end SHA.
  REPOSITORY_STATE_CHANGED = 'REPOSITORY_STATE_CHANGED',

  ACTIVE_VALIDATION = 'ACTIVE_VALIDATION',

  CANCELLED_BEFORE_START = 'CANCELLED_BEFORE_START',
  ENQUEUE_FAILED = 'ENQUEUE_FAILED',
  ORPHANED_VALIDATION = 'ORPHANED_VALIDATION',

  // A required validation check could not be resolved to a real repository
  // command at all (no script, no safely-inferrable fallback).
  VALIDATION_UNAVAILABLE = 'VALIDATION_UNAVAILABLE',
  VALIDATION_FAILED = 'VALIDATION_FAILED',
  VALIDATION_CANCELLED = 'VALIDATION_CANCELLED',

  // A validation command modified tracked files, or the workspace otherwise
  // changed between the pre-validation baseline and the post-validation
  // recheck — never commit over this.
  WORKSPACE_CHANGED_AFTER_VALIDATION = 'WORKSPACE_CHANGED_AFTER_VALIDATION',

  COMMIT_FAILED = 'COMMIT_FAILED',
  WORKSPACE_NOT_CLEAN_AFTER_COMMIT = 'WORKSPACE_NOT_CLEAN_AFTER_COMMIT',

  UNKNOWN_ERROR = 'UNKNOWN_ERROR',
}

export interface TaskValidationErrorOptions {
  code: TaskValidationErrorCode;
  message: string;
  cause?: unknown;
}

export class TaskValidationError extends Error {
  readonly code: TaskValidationErrorCode;
  readonly cause?: unknown;

  constructor(options: TaskValidationErrorOptions) {
    super(options.message);
    this.name = 'TaskValidationError';
    this.code = options.code;
    this.cause = options.cause;
  }
}
