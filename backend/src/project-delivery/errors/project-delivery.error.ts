// Normalized domain error codes for Project completion (Sprint 17) — mirrors
// the TaskExecutionError/SprintExecutionError/SprintAcceptanceError pattern:
// one enum doubles as both getEligibility()'s reason list and the code
// thrown by complete() when a gate fails, so the two can never drift apart.
export enum ProjectDeliveryErrorCode {
  PROJECT_ARCHIVED = 'PROJECT_ARCHIVED',
  // The Project has no SprintPlan at all yet — nothing to complete.
  NO_SPRINT_PLAN = 'NO_SPRINT_PLAN',
  // Covers the whole Sprint 7 assertDevelopmentApproved gate, same
  // deliberate non-decomposition as TaskExecutionErrorCode's own copy of
  // this reason.
  DEVELOPMENT_NOT_APPROVED = 'DEVELOPMENT_NOT_APPROVED',

  // Not a failure reason on its own — getEligibility reports this instead of
  // a checklist once the Project is already COMPLETED, so a client can show
  // "view your delivery" rather than a stale readiness list (item 45).
  PROJECT_ALREADY_COMPLETED = 'PROJECT_ALREADY_COMPLETED',

  // One or more required Sprints (every Sprint in the current SprintPlan)
  // has not mechanically PASSED yet.
  SPRINT_NOT_PASSED = 'SPRINT_NOT_PASSED',
  // A required Sprint PASSED but has not been formally ACCEPTED via Sprint
  // 16's own gate — reuses SprintAcceptanceService.getGateStatus(), never
  // re-derives acceptance rules here (same reasoning as Sprint 14's own
  // dependency gate).
  SPRINT_NOT_ACCEPTED = 'SPRINT_NOT_ACCEPTED',
  // Defensive re-verification, not trusting Sprint.status alone (item's
  // "never trust original validation" principle): a Task belonging to a
  // PASSED, ACCEPTED Sprint is not itself PASSED.
  TASK_NOT_PASSED = 'TASK_NOT_PASSED',
  // A functional requirement from the current ProjectAnalysis has no
  // delivered (PASSED, in an ACCEPTED Sprint) Task covering it.
  REQUIREMENT_NOT_COVERED = 'REQUIREMENT_NOT_COVERED',

  // A Sprint execution is still in flight somewhere in the Project —
  // completion must never race a running orchestration loop.
  ACTIVE_SPRINT_EXECUTION = 'ACTIVE_SPRINT_EXECUTION',

  WORKSPACE_NOT_READY = 'WORKSPACE_NOT_READY',
  WORKSPACE_DIRTY = 'WORKSPACE_DIRTY',
  // The resolved authoritative final SHA (the repositoryEndSha of the
  // required Sprint whose execution completed last) does not equal the live
  // workspace HEAD — the repository moved since that Sprint finished.
  FINAL_SHA_MISMATCH = 'FINAL_SHA_MISMATCH',

  // Live state (Sprint status, acceptance gate, or workspace HEAD) changed
  // between the eligibility snapshot and the point of finalizing — never
  // finalize against stale evidence (item 40), same "double-check right
  // before the point of no return" pattern as Sprint 11/16's own re-checks.
  PROJECT_DELIVERY_STATE_CHANGED = 'PROJECT_DELIVERY_STATE_CHANGED',

  // GET .../delivery on a Project that has never been completed — an
  // ordinary "not found" (the client should show "not delivered yet"), not
  // a server error.
  DELIVERY_NOT_FOUND = 'DELIVERY_NOT_FOUND',

  UNKNOWN_ERROR = 'UNKNOWN_ERROR',
}

export interface ProjectDeliveryErrorOptions {
  code: ProjectDeliveryErrorCode;
  message: string;
  cause?: unknown;
}

export class ProjectDeliveryError extends Error {
  readonly code: ProjectDeliveryErrorCode;
  readonly cause?: unknown;

  constructor(options: ProjectDeliveryErrorOptions) {
    super(options.message);
    this.name = 'ProjectDeliveryError';
    this.code = options.code;
    this.cause = options.cause;
  }
}
