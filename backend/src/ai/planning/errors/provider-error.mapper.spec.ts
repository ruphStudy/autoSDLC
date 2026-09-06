import {
  APIConnectionError,
  AuthenticationError,
  BadRequestError,
  InternalServerError,
  RateLimitError,
} from 'openai';
import { mapOpenAIError } from './provider-error.mapper';
import { PlanningErrorCode } from './planning-ai.error';
import { PlanningTimeoutSignal } from '../utils/timeout';

function headers(entries: Record<string, string> = {}): Headers {
  return new Headers(entries);
}

describe('mapOpenAIError', () => {
  it('maps AuthenticationError to AUTHENTICATION_ERROR, non-retryable', () => {
    const error = new AuthenticationError(401, {}, 'bad key', headers());
    const mapped = mapOpenAIError(error);

    expect(mapped.code).toBe(PlanningErrorCode.AUTHENTICATION_ERROR);
    expect(mapped.retryable).toBe(false);
    expect(mapped.cause).toBe(error);
  });

  it('maps RateLimitError to RATE_LIMITED, retryable, capturing retry-after', () => {
    const error = new RateLimitError(
      429,
      {},
      'slow down',
      headers({ 'retry-after': '2' }),
    );
    const mapped = mapOpenAIError(error);

    expect(mapped.code).toBe(PlanningErrorCode.RATE_LIMITED);
    expect(mapped.retryable).toBe(true);
    expect(mapped.retryAfterMs).toBe(2000);
  });

  it('maps InternalServerError to PROVIDER_UNAVAILABLE, retryable', () => {
    const error = new InternalServerError(500, {}, 'oops', headers());
    const mapped = mapOpenAIError(error);

    expect(mapped.code).toBe(PlanningErrorCode.PROVIDER_UNAVAILABLE);
    expect(mapped.retryable).toBe(true);
  });

  it('maps APIConnectionError to NETWORK_ERROR, retryable', () => {
    const error = new APIConnectionError({ message: 'ECONNRESET' });
    const mapped = mapOpenAIError(error);

    expect(mapped.code).toBe(PlanningErrorCode.NETWORK_ERROR);
    expect(mapped.retryable).toBe(true);
  });

  it('maps BadRequestError to INVALID_REQUEST, non-retryable', () => {
    const error = new BadRequestError(400, {}, 'bad params', headers());
    const mapped = mapOpenAIError(error);

    expect(mapped.code).toBe(PlanningErrorCode.INVALID_REQUEST);
    expect(mapped.retryable).toBe(false);
  });

  it('maps our own timeout signal to TIMEOUT, retryable', () => {
    const mapped = mapOpenAIError(new PlanningTimeoutSignal(90000));

    expect(mapped.code).toBe(PlanningErrorCode.TIMEOUT);
    expect(mapped.retryable).toBe(true);
  });

  it('maps an unrecognized error to UNKNOWN_PROVIDER_ERROR, non-retryable', () => {
    const mapped = mapOpenAIError(new Error('something weird'));

    expect(mapped.code).toBe(PlanningErrorCode.UNKNOWN_PROVIDER_ERROR);
    expect(mapped.retryable).toBe(false);
  });

  it('passes an already-normalized PlanningAIError through unchanged', () => {
    const original = mapOpenAIError(new Error('x'));
    expect(mapOpenAIError(original)).toBe(original);
  });

  it('never surfaces the raw error message as the normalized message (no leaked internals)', () => {
    const error = new AuthenticationError(
      401,
      { secret_hint: 'sk-should-not-leak' },
      'sk-should-not-leak',
      headers(),
    );
    const mapped = mapOpenAIError(error);

    expect(mapped.message).not.toContain('sk-should-not-leak');
  });
});
