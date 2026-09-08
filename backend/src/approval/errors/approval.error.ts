// Normalized domain error codes for the approval workflow — the one error
// type approval-aware services should throw for anything approval-related,
// mirroring the PlanningAIError pattern used for the AI-provider domain.
export enum ApprovalErrorCode {
  // A generation attempt is blocked because the upstream artifact required
  // to unlock it isn't currently approved (e.g. Architecture generation
  // without an approved current Analysis).
  STAGE_NOT_READY = 'approval_stage_not_ready',
  // Nothing exists yet at the stage being decided on (e.g. approving
  // Architecture before any Architecture has been generated).
  CURRENT_VERSION_MISSING = 'approval_current_version_missing',
  // Approving this stage requires an earlier stage's *current* version to
  // already be approved (the approval dependency chain, independent of
  // whether generation itself was ever gated).
  PREREQUISITE_MISSING = 'approval_prerequisite_missing',
  // The artifact version resolved server-side stopped being current between
  // resolution and persistence (a concurrent edit/regeneration raced it).
  VERSION_STALE = 'approval_version_stale',
  // Start Development cannot be approved (or asserted for future execution)
  // because current Analysis/Architecture/SprintPlan are not all approved.
  DEVELOPMENT_PREREQUISITES_MISSING = 'development_approval_prerequisites_missing',
  // CHANGES_REQUESTED was submitted without the feedback comment it needs.
  CHANGES_COMMENT_REQUIRED = 'approval_changes_comment_required',
}

export interface ApprovalErrorOptions {
  code: ApprovalErrorCode;
  message: string;
  cause?: unknown;
}

export class ApprovalError extends Error {
  readonly code: ApprovalErrorCode;
  readonly cause?: unknown;

  constructor(options: ApprovalErrorOptions) {
    super(options.message);
    this.name = 'ApprovalError';
    this.code = options.code;
    this.cause = options.cause;
  }
}
