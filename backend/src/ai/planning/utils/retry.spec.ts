import { withRetry } from './retry';

describe('withRetry', () => {
  it('returns the result on the first successful attempt with attempts=1', async () => {
    const fn = jest.fn().mockResolvedValue('ok');

    const { result, attempts } = await withRetry(fn, {
      maxRetries: 2,
      isRetryable: () => true,
      baseDelayMs: 1,
      maxDelayMs: 1,
    });

    expect(result).toBe('ok');
    expect(attempts).toBe(1);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries a retryable failure and succeeds within the budget', async () => {
    const fn = jest
      .fn()
      .mockRejectedValueOnce(new Error('retryable'))
      .mockResolvedValueOnce('ok');

    const { result, attempts } = await withRetry(fn, {
      maxRetries: 2,
      isRetryable: () => true,
      baseDelayMs: 1,
      maxDelayMs: 1,
    });

    expect(result).toBe('ok');
    expect(attempts).toBe(2);
  });

  it('does not retry a non-retryable failure', async () => {
    const error = new Error('fatal');
    const fn = jest.fn().mockRejectedValue(error);

    await expect(
      withRetry(fn, {
        maxRetries: 3,
        isRetryable: () => false,
        baseDelayMs: 1,
        maxDelayMs: 1,
      }),
    ).rejects.toBe(error);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('stops after the retry budget is exhausted and rethrows the last error', async () => {
    const error = new Error('always fails');
    const fn = jest.fn().mockRejectedValue(error);

    await expect(
      withRetry(fn, {
        maxRetries: 2,
        isRetryable: () => true,
        baseDelayMs: 1,
        maxDelayMs: 1,
      }),
    ).rejects.toBe(error);
    // initial attempt + 2 retries = 3 calls
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('uses delayOverrideMs when provided instead of computed backoff', async () => {
    const fn = jest
      .fn()
      .mockRejectedValueOnce(new Error('rate limited'))
      .mockResolvedValueOnce('ok');
    const start = Date.now();

    await withRetry(fn, {
      maxRetries: 1,
      isRetryable: () => true,
      delayOverrideMs: () => 5,
      baseDelayMs: 10_000,
      maxDelayMs: 10_000,
    });

    expect(Date.now() - start).toBeLessThan(1000);
  });
});
