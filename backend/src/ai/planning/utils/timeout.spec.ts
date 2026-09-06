import { PlanningTimeoutSignal, withTimeout } from './timeout';

describe('withTimeout', () => {
  it('resolves normally when the call finishes before the deadline', async () => {
    const result = await withTimeout(async () => 'ok', 200);
    expect(result).toBe('ok');
  });

  it('throws PlanningTimeoutSignal and aborts the signal when the deadline elapses', async () => {
    let sawAbort = false;

    await expect(
      withTimeout(
        (signal) =>
          new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () => {
              sawAbort = true;
              reject(signal.reason);
            });
          }),
        20,
      ),
    ).rejects.toBeInstanceOf(PlanningTimeoutSignal);

    expect(sawAbort).toBe(true);
  });

  it('clears its deadline timer once the call settles (no lingering timer)', async () => {
    const clearTimeoutSpy = jest.spyOn(global, 'clearTimeout');
    await withTimeout(async () => 'ok', 50);
    expect(clearTimeoutSpy).toHaveBeenCalled();
    clearTimeoutSpy.mockRestore();
  });

  it('propagates an externally-aborted signal reason without wrapping it', async () => {
    const controller = new AbortController();
    const externalError = new Error('cancelled by caller');
    controller.abort(externalError);

    await expect(
      withTimeout(async () => 'ok', 1000, controller.signal),
    ).rejects.toBe(externalError);
  });

  it('aborts the in-flight call when an external signal fires mid-request', async () => {
    const controller = new AbortController();
    const externalError = new Error('cancelled mid-flight');

    const promise = withTimeout(
      (signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason));
        }),
      5000,
      controller.signal,
    );

    setTimeout(() => controller.abort(externalError), 10);

    await expect(promise).rejects.toBe(externalError);
  });
});
