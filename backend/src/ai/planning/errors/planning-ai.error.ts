export enum PlanningErrorCode {
  AUTHENTICATION_ERROR = 'AUTHENTICATION_ERROR',
  RATE_LIMITED = 'RATE_LIMITED',
  TIMEOUT = 'TIMEOUT',
  PROVIDER_UNAVAILABLE = 'PROVIDER_UNAVAILABLE',
  NETWORK_ERROR = 'NETWORK_ERROR',
  INVALID_REQUEST = 'INVALID_REQUEST',
  INVALID_STRUCTURED_RESPONSE = 'INVALID_STRUCTURED_RESPONSE',
  CONTENT_REFUSED = 'CONTENT_REFUSED',
  CONTEXT_LIMIT = 'CONTEXT_LIMIT',
  UNKNOWN_PROVIDER_ERROR = 'UNKNOWN_PROVIDER_ERROR',
  CONFIGURATION_ERROR = 'CONFIGURATION_ERROR',
}

export interface PlanningAIErrorOptions {
  code: PlanningErrorCode;
  message: string;
  provider: string;
  retryable: boolean;
  statusCode?: number;
  cause?: unknown;
  /** Provider-supplied retry hint (e.g. a rate-limit Retry-After header), in ms. */
  retryAfterMs?: number;
}

// The one error type business code (and future providers) should ever need
// to understand — callers never see `OpenAI.APIError` or any other
// SDK-specific exception type.
export class PlanningAIError extends Error {
  readonly code: PlanningErrorCode;
  readonly provider: string;
  readonly retryable: boolean;
  readonly statusCode?: number;
  readonly cause?: unknown;
  readonly retryAfterMs?: number;

  constructor(options: PlanningAIErrorOptions) {
    super(options.message);
    this.name = 'PlanningAIError';
    this.code = options.code;
    this.provider = options.provider;
    this.retryable = options.retryable;
    this.statusCode = options.statusCode;
    this.cause = options.cause;
    this.retryAfterMs = options.retryAfterMs;
  }
}
