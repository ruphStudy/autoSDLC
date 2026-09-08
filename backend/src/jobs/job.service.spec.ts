import {
  ConflictException,
  HttpException,
  NotFoundException,
} from '@nestjs/common';
import { JobEventType, JobStatus, JobType, Prisma } from '@prisma/client';
import { JobService } from './job.service';
import { PrismaService } from '../prisma/prisma.service';
import { ProjectsService } from '../projects/projects.service';
import { ApprovalService } from '../approval/approval.service';
import {
  ApprovalError,
  ApprovalErrorCode,
} from '../approval/errors/approval.error';
import { JobsConfigService } from './jobs.config';

function buildProject(overrides: Partial<Record<string, unknown>> = {}) {
  return { id: 'project-1', userId: 'user-1', archivedAt: null, ...overrides };
}

function buildJobRow(overrides: Partial<Record<string, unknown>> = {}) {
  const now = new Date();
  return {
    id: 'job-1',
    projectId: 'project-1',
    userId: 'user-1',
    type: JobType.SYSTEM_TEST,
    status: JobStatus.QUEUED,
    priority: 0,
    payload: {},
    result: null,
    progress: 0,
    progressMessage: null,
    attemptCount: 0,
    maxAttempts: 3,
    scheduledAt: now,
    startedAt: null,
    completedAt: null,
    failedAt: null,
    cancelledAt: null,
    cancelRequestedAt: null,
    lockedAt: null,
    lockedBy: null,
    lockExpiresAt: null,
    errorCode: null,
    errorMessage: null,
    idempotencyKey: null,
    parentJobId: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('JobService', () => {
  let prisma: {
    job: {
      create: jest.Mock;
      findFirst: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
      findUniqueOrThrow: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
    };
    jobEvent: { create: jest.Mock; findMany: jest.Mock; createMany: jest.Mock };
    $transaction: jest.Mock;
  };
  let projectsService: { findOneForUser: jest.Mock };
  let approvalService: { assertDevelopmentApproved: jest.Mock };
  let config: JobsConfigService;
  let service: JobService;

  beforeEach(() => {
    prisma = {
      job: {
        create: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      jobEvent: {
        create: jest.fn(),
        findMany: jest.fn(),
        createMany: jest.fn(),
      },
      $transaction: jest.fn(async (fn: (tx: unknown) => unknown) => fn(prisma)),
    };
    projectsService = {
      findOneForUser: jest.fn().mockResolvedValue(buildProject()),
    };
    approvalService = {
      assertDevelopmentApproved: jest.fn().mockResolvedValue(undefined),
    };
    config = {
      defaultMaxAttempts: 3,
      maxPayloadBytes: 65536,
      maxResultBytes: 65536,
      lockTimeoutSeconds: 300,
      heartbeatSeconds: 60,
      retryBaseDelaySeconds: 5,
      retryMaxDelaySeconds: 300,
      batchSize: 5,
      pollIntervalMs: 2000,
      workerEnabled: true,
      isTestEnv: true,
    } as unknown as JobsConfigService;

    service = new JobService(
      prisma as unknown as PrismaService,
      projectsService as unknown as ProjectsService,
      approvalService as unknown as ApprovalService,
      config,
    );
  });

  describe('enqueue', () => {
    it('A: creates a QUEUED job and a CREATED event', async () => {
      prisma.job.create.mockResolvedValue(buildJobRow());

      const job = await service.enqueue({
        type: JobType.SYSTEM_TEST,
        payload: { steps: 2 },
      });

      expect(job.status).toBe(JobStatus.QUEUED);
      expect(prisma.job.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: JobType.SYSTEM_TEST,
            maxAttempts: 3,
          }),
        }),
      );
      expect(prisma.jobEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            jobId: 'job-1',
            type: JobEventType.CREATED,
          }),
        }),
      );
    });

    it('does not require development approval for SYSTEM_TEST', async () => {
      prisma.job.create.mockResolvedValue(buildJobRow());
      await service.enqueue({
        type: JobType.SYSTEM_TEST,
        projectId: 'project-1',
        payload: {},
      });
      expect(approvalService.assertDevelopmentApproved).not.toHaveBeenCalled();
    });

    it('B: blocks a development-required job before Start Development is approved', async () => {
      approvalService.assertDevelopmentApproved.mockRejectedValue(
        new ApprovalError({
          code: ApprovalErrorCode.DEVELOPMENT_PREREQUISITES_MISSING,
          message: 'not approved',
        }),
      );

      await expect(
        service.enqueue({
          type: JobType.PROJECT_PREPARATION,
          projectId: 'project-1',
        }),
      ).rejects.toBeInstanceOf(HttpException);
      expect(prisma.job.create).not.toHaveBeenCalled();
    });

    it('C: allows a development-required job once Start Development is approved', async () => {
      prisma.job.create.mockResolvedValue(
        buildJobRow({ type: JobType.PROJECT_PREPARATION }),
      );
      const job = await service.enqueue({
        type: JobType.PROJECT_PREPARATION,
        projectId: 'project-1',
      });
      expect(approvalService.assertDevelopmentApproved).toHaveBeenCalledWith(
        'project-1',
      );
      expect(job.type).toBe(JobType.PROJECT_PREPARATION);
    });

    it('rejects a development-required job with no projectId', async () => {
      await expect(
        service.enqueue({ type: JobType.PROJECT_PREPARATION }),
      ).rejects.toBeInstanceOf(HttpException);
      expect(approvalService.assertDevelopmentApproved).not.toHaveBeenCalled();
    });

    it('rejects a payload larger than the configured limit', async () => {
      const hugePayload = { data: 'x'.repeat(100) };
      config = {
        ...config,
        maxPayloadBytes: 10,
      } as unknown as JobsConfigService;
      service = new JobService(
        prisma as unknown as PrismaService,
        projectsService as unknown as ProjectsService,
        approvalService as unknown as ApprovalService,
        config,
      );

      await expect(
        service.enqueue({ type: JobType.SYSTEM_TEST, payload: hugePayload }),
      ).rejects.toBeInstanceOf(HttpException);
      expect(prisma.job.create).not.toHaveBeenCalled();
    });

    it('V: an idempotent repeat enqueue returns the existing job without creating a duplicate', async () => {
      const existing = buildJobRow({
        idempotencyKey: 'key-1',
        payload: { steps: 2 },
      });
      prisma.job.findFirst.mockResolvedValue(existing);

      const job = await service.enqueue({
        type: JobType.SYSTEM_TEST,
        payload: { steps: 2 },
        idempotencyKey: 'key-1',
      });

      expect(job.id).toBe(existing.id);
      expect(prisma.job.create).not.toHaveBeenCalled();
    });

    it('W: the same idempotency key with a different payload conflicts', async () => {
      const existing = buildJobRow({
        idempotencyKey: 'key-1',
        payload: { steps: 2 },
      });
      prisma.job.findFirst.mockResolvedValue(existing);

      await expect(
        service.enqueue({
          type: JobType.SYSTEM_TEST,
          payload: { steps: 99 },
          idempotencyKey: 'key-1',
        }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.job.create).not.toHaveBeenCalled();
    });

    it('reconciles a concurrent identical enqueue that lost the unique-constraint race', async () => {
      prisma.job.findFirst
        .mockResolvedValueOnce(null) // pre-check: no existing job yet
        .mockResolvedValueOnce(
          buildJobRow({ idempotencyKey: 'key-1', payload: { steps: 2 } }),
        );
      prisma.$transaction.mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError('duplicate', {
          code: 'P2002',
          clientVersion: '6.19.3',
        }),
      );

      const job = await service.enqueue({
        type: JobType.SYSTEM_TEST,
        payload: { steps: 2 },
        idempotencyKey: 'key-1',
      });
      expect(job.idempotencyKey).toBe('key-1');
    });
  });

  describe('enqueuePublic', () => {
    it('Y: rejects a project the caller does not own', async () => {
      projectsService.findOneForUser.mockRejectedValue(new NotFoundException());
      await expect(
        service.enqueuePublic(
          'user-2',
          'project-1',
          JobType.PROJECT_PREPARATION,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.job.create).not.toHaveBeenCalled();
    });

    it('builds an empty payload for PROJECT_PREPARATION regardless of caller input', async () => {
      prisma.job.create.mockResolvedValue(
        buildJobRow({ type: JobType.PROJECT_PREPARATION }),
      );
      await service.enqueuePublic(
        'user-1',
        'project-1',
        JobType.PROJECT_PREPARATION,
      );
      expect(prisma.job.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ payload: {} }),
        }),
      );
    });
  });

  describe('list / getById / getEvents', () => {
    it('Y: enforces project ownership before listing', async () => {
      projectsService.findOneForUser.mockRejectedValue(new NotFoundException());
      await expect(
        service.list('user-2', 'project-1', {}),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.job.findMany).not.toHaveBeenCalled();
    });

    it('lists newest first, bounded to a max of 100', async () => {
      prisma.job.findMany.mockResolvedValue([buildJobRow()]);
      await service.list('user-1', 'project-1', { limit: 500 });
      expect(prisma.job.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ projectId: 'project-1' }),
          orderBy: { createdAt: 'desc' },
          take: 100,
        }),
      );
    });

    it('returns 404 for a job belonging to a different project', async () => {
      prisma.job.findFirst.mockResolvedValue(null);
      await expect(
        service.getById('user-1', 'project-1', 'job-999'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('X: returns events in chronological (ascending) order', async () => {
      prisma.job.findFirst.mockResolvedValue({ id: 'job-1' });
      prisma.jobEvent.findMany.mockResolvedValue([]);
      await service.getEvents('user-1', 'project-1', 'job-1');
      expect(prisma.jobEvent.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { jobId: 'job-1' },
          orderBy: { createdAt: 'asc' },
        }),
      );
    });
  });

  describe('cancel', () => {
    it('O: cancels a QUEUED job immediately', async () => {
      prisma.job.findFirst.mockResolvedValue(
        buildJobRow({ status: JobStatus.QUEUED }),
      );
      prisma.job.updateMany.mockResolvedValue({ count: 1 });
      prisma.job.findUniqueOrThrow.mockResolvedValue(
        buildJobRow({ status: JobStatus.CANCELLED }),
      );

      const job = await service.cancel('user-1', 'project-1', 'job-1');
      expect(job.status).toBe(JobStatus.CANCELLED);
      expect(prisma.jobEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { jobId: 'job-1', type: JobEventType.CANCELLED },
        }),
      );
    });

    it('cancels a RETRY_WAIT job immediately', async () => {
      prisma.job.findFirst.mockResolvedValue(
        buildJobRow({ status: JobStatus.RETRY_WAIT }),
      );
      prisma.job.updateMany.mockResolvedValue({ count: 1 });
      prisma.job.findUniqueOrThrow.mockResolvedValue(
        buildJobRow({ status: JobStatus.CANCELLED }),
      );

      const job = await service.cancel('user-1', 'project-1', 'job-1');
      expect(job.status).toBe(JobStatus.CANCELLED);
    });

    it('P: requests cancellation on a RUNNING job rather than cancelling it directly', async () => {
      prisma.job.findFirst.mockResolvedValue(
        buildJobRow({ status: JobStatus.RUNNING }),
      );
      prisma.job.updateMany.mockResolvedValue({ count: 1 });
      prisma.job.findUniqueOrThrow.mockResolvedValue(
        buildJobRow({
          status: JobStatus.RUNNING,
          cancelRequestedAt: new Date(),
        }),
      );

      const job = await service.cancel('user-1', 'project-1', 'job-1');
      expect(job.status).toBe(JobStatus.RUNNING);
      expect(job.cancelRequestedAt).not.toBeNull();
      expect(prisma.jobEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { jobId: 'job-1', type: JobEventType.CANCEL_REQUESTED },
        }),
      );
    });

    it('does not duplicate the cancel request on a RUNNING job that already has one', async () => {
      prisma.job.findFirst.mockResolvedValue(
        buildJobRow({
          status: JobStatus.RUNNING,
          cancelRequestedAt: new Date(),
        }),
      );

      await service.cancel('user-1', 'project-1', 'job-1');
      expect(prisma.job.updateMany).not.toHaveBeenCalled();
      expect(prisma.jobEvent.create).not.toHaveBeenCalled();
    });

    it('is idempotent when the job is already CANCELLED', async () => {
      prisma.job.findFirst.mockResolvedValue(
        buildJobRow({ status: JobStatus.CANCELLED }),
      );
      const job = await service.cancel('user-1', 'project-1', 'job-1');
      expect(job.status).toBe(JobStatus.CANCELLED);
      expect(prisma.job.updateMany).not.toHaveBeenCalled();
    });

    it('rejects cancelling a job that already succeeded', async () => {
      prisma.job.findFirst.mockResolvedValue(
        buildJobRow({ status: JobStatus.SUCCEEDED }),
      );
      await expect(
        service.cancel('user-1', 'project-1', 'job-1'),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('rejects cancelling a job that already failed', async () => {
      prisma.job.findFirst.mockResolvedValue(
        buildJobRow({ status: JobStatus.FAILED }),
      );
      await expect(
        service.cancel('user-1', 'project-1', 'job-1'),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('Y: rejects cancelling a job in a project the caller does not own', async () => {
      projectsService.findOneForUser.mockRejectedValue(new NotFoundException());
      await expect(
        service.cancel('user-2', 'project-1', 'job-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('worker-facing primitives', () => {
    it('T/U: heartbeat only extends the lock when this worker owns the RUNNING job', async () => {
      prisma.job.updateMany.mockResolvedValue({ count: 1 });
      const ok = await service.heartbeat('job-1', 'worker-a');
      expect(ok).toBe(true);
      expect(prisma.job.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: 'job-1',
            status: JobStatus.RUNNING,
            lockedBy: 'worker-a',
          },
        }),
      );
    });

    it('heartbeat reports failure when it does not own the job', async () => {
      prisma.job.updateMany.mockResolvedValue({ count: 0 });
      const ok = await service.heartbeat('job-1', 'worker-b');
      expect(ok).toBe(false);
    });

    it('I: records progress and a PROGRESS event on a meaningful percentage change', async () => {
      prisma.job.findUnique.mockResolvedValue({
        progress: 0,
        progressMessage: null,
      });
      await service.recordProgress('job-1', 45, 'Halfway there');
      expect(prisma.job.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { progress: 45, progressMessage: 'Halfway there' },
        }),
      );
      expect(prisma.jobEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            jobId: 'job-1',
            type: JobEventType.PROGRESS,
          }),
        }),
      );
    });

    it('does not spam a PROGRESS event for a sub-decile change with no message', async () => {
      prisma.job.findUnique.mockResolvedValue({
        progress: 41,
        progressMessage: 'Working',
      });
      await service.recordProgress('job-1', 42);
      expect(prisma.jobEvent.create).not.toHaveBeenCalled();
    });

    it('clamps progress to the 0-100 range', async () => {
      prisma.job.findUnique.mockResolvedValue({
        progress: 0,
        progressMessage: null,
      });
      await service.recordProgress('job-1', 150);
      expect(prisma.job.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ progress: 100 }),
        }),
      );
    });

    it('isCancellationRequested reflects cancelRequestedAt', async () => {
      prisma.job.findUnique.mockResolvedValue({
        cancelRequestedAt: new Date(),
      });
      expect(await service.isCancellationRequested('job-1')).toBe(true);

      prisma.job.findUnique.mockResolvedValue({ cancelRequestedAt: null });
      expect(await service.isCancellationRequested('job-1')).toBe(false);
    });
  });
});
