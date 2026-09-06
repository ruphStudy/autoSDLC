import {
  APIConnectionError,
  APIError,
  AuthenticationError,
  PermissionDeniedError,
  RateLimitError,
  InternalServerError,
} from 'openai';
import { PlanningAIError, PlanningErrorCode } from './planning-ai.error';
import { PlanningTimeoutSignal } from '../utils/timeout';

const PROVIDER = 'openai';

/** Seconds→ms from a `Retry-After` header, when the SDK exposes response headers. */
export function readRetryAfterMs(error: unknown): number | undefined {
  if (!(error instanceof APIError) || !error.headers) {
    return undefined;
  }
  const raw = error.headers.get?.('retry-after');
  const seconds = raw ? Number(raw) : NaN;
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : undefined;
}

/**
 * Converts anything the OpenAI SDK (or our own timeout wrapper) can throw
 * into the one error type the rest of the application understands. Never
 * passes through raw SDK error objects or their headers/bodies.
 */
export function mapOpenAIError(error: unknown): PlanningAIError {
  if (error instanceof PlanningAIError) {
    return error;
  }

  if (error instanceof PlanningTimeoutSignal) {
    return new PlanningAIError({
      code: PlanningErrorCode.TIMEOUT,
      message: error.message,
      provider: PROVIDER,
      retryable: true,
      cause: error,
    });
  }

  if (
    error instanceof AuthenticationError ||
    error instanceof PermissionDeniedError
  ) {
    return new PlanningAIError({
      code: PlanningErrorCode.AUTHENTICATION_ERROR,
      message: 'Planning AI provider rejected the configured credentials.',
      provider: PROVIDER,
      retryable: false,
      statusCode: error.status,
      cause: error,
    });
  }

  if (error instanceof RateLimitError) {
    return new PlanningAIError({
      code: PlanningErrorCode.RATE_LIMITED,
      message: 'Planning AI provider rate limit exceeded.',
      provider: PROVIDER,
      retryable: true,
      statusCode: error.status,
      cause: error,
      retryAfterMs: readRetryAfterMs(error),
    });
  }

  if (error instanceof InternalServerError) {
    return new PlanningAIError({
      code: PlanningErrorCode.PROVIDER_UNAVAILABLE,
      message: 'Planning AI provider returned a server error.',
      provider: PROVIDER,
      retryable: true,
      statusCode: error.status,
      cause: error,
    });
  }

  if (error instanceof APIConnectionError) {
    return new PlanningAIError({
      code: PlanningErrorCode.NETWORK_ERROR,
      message: 'Could not reach the planning AI provider.',
      provider: PROVIDER,
      retryable: true,
      cause: error,
    });
  }

  if (error instanceof APIError) {
    // BadRequestError, UnprocessableEntityError, NotFoundError, ConflictError,
    // and any future subclass we haven't special-cased: treat as a client-side
    // request problem, not worth retrying blindly.
    return new PlanningAIError({
      code: PlanningErrorCode.INVALID_REQUEST,
      message: 'Planning AI provider rejected the request.',
      provider: PROVIDER,
      retryable: false,
      statusCode: error.status,
      cause: error,
    });
  }

  return new PlanningAIError({
    code: PlanningErrorCode.UNKNOWN_PROVIDER_ERROR,
    message: 'Planning AI provider call failed for an unknown reason.',
    provider: PROVIDER,
    retryable: false,
    cause: error,
  });
}
