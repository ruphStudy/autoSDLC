import { SystemTestJobHandler } from './system-test.handler';
import { JobCancelledError, JobExecutionError } from '../errors/job.error';
import { JobExecutionContext } from '../types/job.types';

function buildContext(
  overrides: Partial<
    JobExecutionContext<{ steps?: number; failUntilAttempt?: number }>
  > = {},
): JobExecutionContext<{ steps?: number; failUntilAttempt?: number }> {
  return {
    jobId: 'job-1',
    projectId: null,
    userId: null,
    attemptCount: 1,
    maxAttempts: 3,
    payload: {},
    reportProgress: jest.fn().mockResolvedValue(undefined),
    isCancellationRequested: jest.fn().mockResolvedValue(false),
    heartbeat: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('SystemTestJobHandler', () => {
  const handler = new SystemTestJobHandler();

  it('reports progress for each step and returns a deterministic result', async () => {
    const context = buildContext({ payload: { steps: 4 } });

    const outcome = await handler.execute(context);

    expect(context.reportProgress).toHaveBeenCalledTimes(4);
    expect(context.reportProgress).toHaveBeenLastCalledWith(100, 'Step 4 of 4');
    expect(outcome).toEqual({ result: { steps: 4, attemptCount: 1 } });
  });

  it('fails with a retryable error while the attempt count is below failUntilAttempt', async () => {
    const context = buildContext({
      payload: { steps: 1, failUntilAttempt: 3 },
      attemptCount: 1,
    });

    await expect(handler.execute(context)).rejects.toMatchObject({
      code: 'system_test_forced_failure',
      retryable: true,
    });
  });

  it('succeeds once the attempt count reaches failUntilAttempt', async () => {
    const context = buildContext({
      payload: { steps: 1, failUntilAttempt: 3 },
      attemptCount: 3,
    });
    const outcome = await handler.execute(context);
    expect(outcome).toEqual({ result: { steps: 1, attemptCount: 3 } });
  });

  it('throws JobExecutionError (not a generic Error) so retryability is explicit', async () => {
    const context = buildContext({
      payload: { steps: 1, failUntilAttempt: 2 },
      attemptCount: 1,
    });
    await expect(handler.execute(context)).rejects.toBeInstanceOf(
      JobExecutionError,
    );
  });

  it('stops cooperatively when cancellation is observed mid-loop', async () => {
    const context = buildContext({
      payload: { steps: 5 },
      isCancellationRequested: jest
        .fn()
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true),
    });

    await expect(handler.execute(context)).rejects.toBeInstanceOf(
      JobCancelledError,
    );
    // Only the first step's progress should have been reported before the
    // second iteration's cancellation check stopped it.
    expect(context.reportProgress).toHaveBeenCalledTimes(1);
  });

  it('defaults to 3 steps when none are specified', async () => {
    const context = buildContext({ payload: {} });
    const outcome = await handler.execute(context);
    expect(outcome).toEqual({ result: { steps: 3, attemptCount: 1 } });
  });
});
