import { JobEventType, JobStatus, JobType } from '@prisma/client';
import { JobWorkerService } from './job-worker.service';
import { PrismaService } from '../prisma/prisma.service';
import { JobService } from './job.service';
import { JobHandlerRegistry } from './job-handler.registry';
import { JobsConfigService } from './jobs.config';
import { JobCancelledError, JobExecutionError } from './errors/job.error';
import { JobHandler } from './types/job.types';

function buildJobRow(overrides: Partial<Record<string, unknown>> = {}) {
  const now = new Date();
  return {
    id: 'job-1',
    projectId: 'project-1',
    userId: 'user-1',
    type: JobType.SYSTEM_TEST,
    status: JobStatus.RUNNING,
    priority: 0,
    payload: {},
    result: null,
    progress: 0,
    progressMessage: null,
    attemptCount: 1,
    maxAttempts: 3,
    scheduledAt: now,
    startedAt: now,
    completedAt: null,
    failedAt: null,
    cancelledAt: null,
    cancelRequestedAt: null,
    lockedAt: now,
    lockedBy: 'worker-under-test',
    lockExpiresAt: new Date(Date.now() + 300_000),
    errorCode: null,
    errorMessage: null,
    idempotencyKey: null,
    parentJobId: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('JobWorkerService', () => {
  let prisma: {
    $transaction: jest.Mock;
    $queryRaw: jest.Mock;
    job: { updateMany: jest.Mock; findMany: jest.Mock };
    jobEvent: { create: jest.Mock; createMany: jest.Mock };
  };
  let jobService: {
    recordProgress: jest.Mock;
    isCancellationRequested: jest.Mock;
    heartbeat: jest.Mock;
  };
  let registry: { resolve: jest.Mock };
  let config: JobsConfigService;
  let worker: JobWorkerService;

  beforeEach(() => {
    prisma = {
      $transaction: jest.fn(async (fn: (tx: unknown) => unknown) => fn(prisma)),
      $queryRaw: jest.fn(),
      job: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      jobEvent: { create: jest.fn(), createMany: jest.fn() },
    };
    jobService = {
      recordProgress: jest.fn(),
      isCancellationRequested: jest.fn().mockResolvedValue(false),
      heartbeat: jest.fn(),
    };
    registry = { resolve: jest.fn() };
    config = {
      batchSize: 5,
      lockTimeoutSeconds: 300,
      retryBaseDelaySeconds: 5,
      retryMaxDelaySeconds: 300,
      maxResultBytes: 65536,
      workerEnabled: false,
      isTestEnv: true,
      pollIntervalMs: 2000,
    } as unknown as JobsConfigService;

    worker = new JobWorkerService(
      prisma as unknown as PrismaService,
      jobService as unknown as JobService,
      registry as unknown as JobHandlerRegistry,
      config,
    );
  });

  // executeJob is private; drive it through the same claimBatch() shape by
  // calling the private method via a narrow cast — keeps the test focused
  // on decision logic without needing real DB concurrency semantics (that
  // lives in the job-worker e2e integration spec instead).
  function callExecuteJob(job: ReturnType<typeof buildJobRow>): Promise<void> {
    return (
      worker as unknown as { executeJob: (j: unknown) => Promise<void> }
    ).executeJob(job);
  }

  describe('executeJob', () => {
    it('G/H: persists a SUCCEEDED status and the handler result', async () => {
      const handler: JobHandler = {
        type: JobType.SYSTEM_TEST,
        execute: jest.fn().mockResolvedValue({ result: { ok: true } }),
      };
      registry.resolve.mockReturnValue(handler);

      await callExecuteJob(buildJobRow());

      expect(prisma.job.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: 'job-1',
            status: JobStatus.RUNNING,
            lockedBy: worker.workerId,
          },
          data: expect.objectContaining({
            status: JobStatus.SUCCEEDED,
            result: { ok: true },
          }),
        }),
      );
      expect(prisma.jobEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { jobId: 'job-1', type: JobEventType.SUCCEEDED },
        }),
      );
    });

    it('marks FAILED instead of SUCCEEDED when the result exceeds the size limit', async () => {
      config = { ...config, maxResultBytes: 5 } as unknown as JobsConfigService;
      worker = new JobWorkerService(
        prisma as unknown as PrismaService,
        jobService as unknown as JobService,
        registry as unknown as JobHandlerRegistry,
        config,
      );
      const handler: JobHandler = {
        type: JobType.SYSTEM_TEST,
        execute: jest
          .fn()
          .mockResolvedValue({ result: { data: 'much too long for the cap' } }),
      };
      registry.resolve.mockReturnValue(handler);

      await callExecuteJob(buildJobRow());

      expect(prisma.job.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: JobStatus.FAILED,
            errorCode: 'job_result_too_large',
          }),
        }),
      );
    });

    it('J: fails permanently on a non-retryable handler error', async () => {
      const handler: JobHandler = {
        type: JobType.SYSTEM_TEST,
        execute: jest
          .fn()
          .mockRejectedValue(new JobExecutionError('bad_input', 'nope', false)),
      };
      registry.resolve.mockReturnValue(handler);

      await callExecuteJob(buildJobRow({ attemptCount: 1, maxAttempts: 3 }));

      expect(prisma.job.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: JobStatus.FAILED,
            errorCode: 'bad_input',
          }),
        }),
      );
    });

    it('J: an unrecognized thrown Error defaults to non-retryable', async () => {
      const handler: JobHandler = {
        type: JobType.SYSTEM_TEST,
        execute: jest.fn().mockRejectedValue(new Error('boom')),
      };
      registry.resolve.mockReturnValue(handler);

      await callExecuteJob(buildJobRow({ attemptCount: 1, maxAttempts: 3 }));

      expect(prisma.job.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: JobStatus.FAILED }),
        }),
      );
    });

    it('K: schedules a retry for a retryable error with attempts remaining', async () => {
      const handler: JobHandler = {
        type: JobType.SYSTEM_TEST,
        execute: jest
          .fn()
          .mockRejectedValue(new JobExecutionError('flaky', 'try again', true)),
      };
      registry.resolve.mockReturnValue(handler);

      await callExecuteJob(buildJobRow({ attemptCount: 1, maxAttempts: 3 }));

      expect(prisma.job.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: JobStatus.RETRY_WAIT,
            errorCode: 'flaky',
          }),
        }),
      );
      expect(prisma.jobEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ type: JobEventType.RETRY_SCHEDULED }),
        }),
      );
    });

    it('M: fails permanently once max attempts are reached even for a retryable error', async () => {
      const handler: JobHandler = {
        type: JobType.SYSTEM_TEST,
        execute: jest
          .fn()
          .mockRejectedValue(new JobExecutionError('flaky', 'try again', true)),
      };
      registry.resolve.mockReturnValue(handler);

      await callExecuteJob(buildJobRow({ attemptCount: 3, maxAttempts: 3 }));

      expect(prisma.job.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: JobStatus.FAILED }),
        }),
      );
    });

    it('N: fails safely when no handler is registered for the job type', async () => {
      registry.resolve.mockReturnValue(undefined);

      await callExecuteJob(buildJobRow({ type: JobType.PROJECT_PREPARATION }));

      expect(prisma.job.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: JobStatus.FAILED,
            errorCode: 'job_unknown_handler',
          }),
        }),
      );
    });

    it('P: marks CANCELLED (not FAILED) when the handler cooperates with cancellation', async () => {
      const handler: JobHandler = {
        type: JobType.SYSTEM_TEST,
        execute: jest.fn().mockRejectedValue(new JobCancelledError()),
      };
      registry.resolve.mockReturnValue(handler);

      await callExecuteJob(buildJobRow());

      expect(prisma.job.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: JobStatus.CANCELLED }),
        }),
      );
      expect(prisma.jobEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { jobId: 'job-1', type: JobEventType.CANCELLED },
        }),
      );
    });

    it('preserves real completion when the handler finishes without observing cancellation', async () => {
      const handler: JobHandler = {
        type: JobType.SYSTEM_TEST,
        execute: jest.fn().mockResolvedValue({ result: { done: true } }),
      };
      registry.resolve.mockReturnValue(handler);

      await callExecuteJob(buildJobRow());

      expect(prisma.job.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: JobStatus.SUCCEEDED }),
        }),
      );
    });

    it('no-ops silently when this worker no longer owns the job (lost via stale-lock recovery)', async () => {
      prisma.job.updateMany.mockResolvedValue({ count: 0 });
      const handler: JobHandler = {
        type: JobType.SYSTEM_TEST,
        execute: jest.fn().mockResolvedValue({ result: {} }),
      };
      registry.resolve.mockReturnValue(handler);

      await callExecuteJob(buildJobRow());

      expect(prisma.jobEvent.create).not.toHaveBeenCalled();
    });
  });

  describe('recoverStaleLocks', () => {
    it('R: reschedules a stale job with attempts remaining, recording both events', async () => {
      prisma.job.findMany.mockResolvedValue([
        { id: 'job-1', attemptCount: 1, maxAttempts: 3 },
      ]);

      await worker.recoverStaleLocks();

      expect(prisma.job.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: JobStatus.RETRY_WAIT }),
        }),
      );
      const eventTypes = prisma.jobEvent.create.mock.calls.map(
        (call) => call[0].data.type,
      );
      expect(eventTypes).toEqual([
        JobEventType.LOCK_RECOVERED,
        JobEventType.RETRY_SCHEDULED,
      ]);
    });

    it('S: fails a stale job whose attempts are exhausted, recording both events', async () => {
      prisma.job.findMany.mockResolvedValue([
        { id: 'job-1', attemptCount: 3, maxAttempts: 3 },
      ]);

      await worker.recoverStaleLocks();

      expect(prisma.job.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: JobStatus.FAILED }),
        }),
      );
      const eventTypes = prisma.jobEvent.create.mock.calls.map(
        (call) => call[0].data.type,
      );
      expect(eventTypes).toEqual([
        JobEventType.LOCK_RECOVERED,
        JobEventType.FAILED,
      ]);
    });

    it('never touches jobs that are not stale (none found)', async () => {
      prisma.job.findMany.mockResolvedValue([]);
      await worker.recoverStaleLocks();
      expect(prisma.job.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('lifecycle', () => {
    it('does not start polling when the worker is disabled', () => {
      worker.onModuleInit();
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });

    it('does not start polling under NODE_ENV=test even if enabled', () => {
      config = {
        ...config,
        workerEnabled: true,
        isTestEnv: true,
      } as unknown as JobsConfigService;
      worker = new JobWorkerService(
        prisma as unknown as PrismaService,
        jobService as unknown as JobService,
        registry as unknown as JobHandlerRegistry,
        config,
      );
      worker.onModuleInit();
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });
  });
});
