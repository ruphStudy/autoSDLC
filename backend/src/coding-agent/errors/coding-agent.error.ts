// Normalized domain error codes for the coding-agent layer — the one error
// type application code should ever need to understand; callers never see
// raw Claude Agent SDK message/error shapes. Mirrors the PlanningAIError /
// GitError pattern used elsewhere in this codebase.
export enum CodingAgentErrorCode {
  CONFIGURATION_ERROR = 'CONFIGURATION_ERROR',
  AUTHENTICATION_ERROR = 'AUTHENTICATION_ERROR',
  PROVIDER_UNAVAILABLE = 'PROVIDER_UNAVAILABLE',
  RATE_LIMITED = 'RATE_LIMITED',
  TIMEOUT = 'TIMEOUT',
  CANCELLED = 'CANCELLED',
  WORKSPACE_NOT_READY = 'WORKSPACE_NOT_READY',
  WORKSPACE_DIRTY = 'WORKSPACE_DIRTY',
  PERMISSION_DENIED = 'PERMISSION_DENIED',
  TOOL_ERROR = 'TOOL_ERROR',
  COMMAND_FAILED = 'COMMAND_FAILED',
  MAX_TURNS_EXCEEDED = 'MAX_TURNS_EXCEEDED',
  INVALID_REQUEST = 'INVALID_REQUEST',
  UNKNOWN_PROVIDER_ERROR = 'UNKNOWN_PROVIDER_ERROR',
}

export interface CodingAgentErrorOptions {
  code: CodingAgentErrorCode;
  message: string;
  // Whether an automatic retry could ever be safe. Almost always false —
  // see CodingAgentService: coding execution is stateful (may have already
  // modified the workspace), so only a failure PROVEN to have happened
  // before any tool/file activity should ever be marked retryable.
  retryable?: boolean;
  cause?: unknown;
}

export class CodingAgentError extends Error {
  readonly code: CodingAgentErrorCode;
  readonly retryable: boolean;
  readonly cause?: unknown;

  constructor(options: CodingAgentErrorOptions) {
    super(options.message);
    this.name = 'CodingAgentError';
    this.code = options.code;
    this.retryable = options.retryable ?? false;
    this.cause = options.cause;
  }
}
