// Doubles as both getEligibility()'s reason list and the code thrown by
// generate()/accept()/reject() when a gate fails — one vocabulary, so the
// two can never drift (same pattern as Sprint 12/13/14's own error codes).
export enum SprintAcceptanceErrorCode {
  SPRINT_NOT_FOUND = 'SPRINT_NOT_FOUND',
  ACCEPTANCE_NOT_FOUND = 'ACCEPTANCE_NOT_FOUND',
  PROJECT_ARCHIVED = 'PROJECT_ARCHIVED',
  PLAN_LINEAGE_MISMATCH = 'PLAN_LINEAGE_MISMATCH',
  SPRINT_NOT_PASSED = 'SPRINT_NOT_PASSED',
  SPRINT_EXECUTION_NOT_COMPLETED = 'SPRINT_EXECUTION_NOT_COMPLETED',
  TASK_NOT_PASSED = 'TASK_NOT_PASSED',
  MISSING_VALIDATION_EVIDENCE = 'MISSING_VALIDATION_EVIDENCE',
  MISSING_COMMIT_EVIDENCE = 'MISSING_COMMIT_EVIDENCE',
  WORKSPACE_NOT_READY = 'WORKSPACE_NOT_READY',
  WORKSPACE_DIRTY = 'WORKSPACE_DIRTY',
  FINAL_SHA_MISMATCH = 'FINAL_SHA_MISMATCH',
  ACTIVE_EXECUTION = 'ACTIVE_EXECUTION',
  ACTIVE_ACCEPTANCE_REVIEW = 'ACTIVE_ACCEPTANCE_REVIEW',
  REPOSITORY_STATE_CHANGED = 'REPOSITORY_STATE_CHANGED',
  REVIEW_STALE = 'REVIEW_STALE',
  NOT_READY_FOR_DECISION = 'NOT_READY_FOR_DECISION',
  ALREADY_DECIDED = 'ALREADY_DECIDED',
  ENQUEUE_FAILED = 'ENQUEUE_FAILED',
  INVALID_REVIEW_RESPONSE = 'INVALID_REVIEW_RESPONSE',
  UNKNOWN_ERROR = 'UNKNOWN_ERROR',
}

export class SprintAcceptanceError extends Error {
  readonly code: SprintAcceptanceErrorCode;

  constructor(params: { code: SprintAcceptanceErrorCode; message: string }) {
    super(params.message);
    this.name = 'SprintAcceptanceError';
    this.code = params.code;
  }
}
