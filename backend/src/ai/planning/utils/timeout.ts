// Thrown by withTimeout when our own deadline elapses — distinct from
// whatever the underlying call throws, so callers can tell "we gave up
// waiting" apart from a provider-reported failure.
export class PlanningTimeoutSignal extends Error {
  constructor(timeoutMs: number) {
    super(`Planning AI call did not complete within ${timeoutMs}ms`);
    this.name = 'PlanningTimeoutSignal';
  }
}

/**
 * Runs `fn` with an application-controlled deadline. `fn` receives an
 * AbortSignal it should pass through to the underlying HTTP call (the OpenAI
 * SDK accepts one as a request option) so the in-flight request is actually
 * aborted, not just abandoned. If a caller-supplied `externalSignal` aborts
 * first, that reason propagates as-is (not wrapped) so intentional
 * cancellation is never mistaken for a timeout or provider failure.
 */
export async function withTimeout<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  externalSignal?: AbortSignal,
): Promise<T> {
  if (externalSignal?.aborted) {
    throw externalSignal.reason ?? new Error('Aborted');
  }

  const controller = new AbortController();
  const onExternalAbort = () => controller.abort(externalSignal?.reason);
  externalSignal?.addEventListener('abort', onExternalAbort);

  const timer = setTimeout(
    () => controller.abort(new PlanningTimeoutSignal(timeoutMs)),
    timeoutMs,
  );

  try {
    return await fn(controller.signal);
  } catch (err) {
    if (
      controller.signal.aborted &&
      controller.signal.reason instanceof PlanningTimeoutSignal
    ) {
      throw controller.signal.reason;
    }
    if (externalSignal?.aborted) {
      throw externalSignal.reason ?? err;
    }
    throw err;
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener('abort', onExternalAbort);
  }
}
