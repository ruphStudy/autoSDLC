// Normalized domain error codes for the job system — mirrors the
// PlanningAIError / ApprovalError pattern already used elsewhere.
export enum JobErrorCode {
  INVALID_PAYLOAD = 'job_invalid_payload',
  PAYLOAD_TOO_LARGE = 'job_payload_too_large',
  RESULT_TOO_LARGE = 'job_result_too_large',
  UNKNOWN_TYPE = 'job_unknown_type',
  IDEMPOTENCY_CONFLICT = 'job_idempotency_conflict',
  NOT_CANCELLABLE = 'job_not_cancellable',
}

export interface JobErrorOptions {
  code: JobErrorCode;
  message: string;
}

export class JobError extends Error {
  readonly code: JobErrorCode;

  constructor(options: JobErrorOptions) {
    super(options.message);
    this.name = 'JobError';
    this.code = options.code;
  }
}

// Thrown by a handler to signal it observed a cancellation request and
// stopped cooperatively. The worker treats this distinctly from a normal
// failure — the job is marked CANCELLED, never FAILED or retried.
export class JobCancelledError extends Error {
  constructor() {
    super('Job execution was cancelled.');
    this.name = 'JobCancelledError';
  }
}

// Thrown by a handler to report a normalized execution failure. A plain
// thrown Error is always treated as non-retryable (see
// JobWorkerService.normalizeExecutionError) — handlers must be explicit via
// this class to opt into retry.
export class JobExecutionError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(code: string, message: string, retryable: boolean) {
    super(message);
    this.name = 'JobExecutionError';
    this.code = code;
    this.retryable = retryable;
  }
}
