function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Bounded exponential backoff with jitter: 500ms, 1000ms, 2000ms, ... capped,
// plus up to 30% random jitter so concurrent retries don't all land at once.
function backoffDelay(
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number,
): number {
  const exponential = baseDelayMs * 2 ** (attempt - 1);
  const capped = Math.min(exponential, maxDelayMs);
  const jitter = capped * 0.3 * Math.random();
  return Math.round(capped + jitter);
}

export interface RetryOptions {
  maxRetries: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  isRetryable: (error: unknown) => boolean;
  /** Optional override for a specific attempt's delay (e.g. provider retry-after). */
  delayOverrideMs?: (error: unknown) => number | undefined;
}

export interface RetryResult<T> {
  result: T;
  attempts: number;
}

/**
 * Calls `fn` up to `1 + maxRetries` times. Only retries when `isRetryable`
 * accepts the thrown error; the last error is rethrown once the budget is
 * exhausted or the error isn't retryable. `attempt` passed to `fn` is
 * 1-indexed.
 */
export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  options: RetryOptions,
): Promise<RetryResult<T>> {
  const baseDelayMs = options.baseDelayMs ?? 500;
  const maxDelayMs = options.maxDelayMs ?? 8000;

  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    attempt += 1;
    try {
      const result = await fn(attempt);
      return { result, attempts: attempt };
    } catch (error) {
      const hasBudget = attempt <= options.maxRetries;
      if (!hasBudget || !options.isRetryable(error)) {
        throw error;
      }
      const overrideMs = options.delayOverrideMs?.(error);
      await sleep(overrideMs ?? backoffDelay(attempt, baseDelayMs, maxDelayMs));
    }
  }
}
