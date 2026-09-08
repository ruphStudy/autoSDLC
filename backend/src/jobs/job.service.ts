import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Job, JobEventType, JobStatus, JobType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ProjectsService } from '../projects/projects.service';
import { ApprovalService } from '../approval/approval.service';
import { ApprovalError } from '../approval/errors/approval.error';
import { mapApprovalErrorToHttpException } from '../approval/errors/approval-error.mapper';
import { JobsConfigService } from './jobs.config';
import { JobError, JobErrorCode } from './errors/job.error';
import { mapJobErrorToHttpException } from './errors/job-error.mapper';
import {
  isValidJobTransition,
  JOB_TYPE_REQUIRES_DEVELOPMENT_APPROVAL,
} from './jobs.constants';
import { EnqueueJobParams, JobEventRecord, JobRecord } from './types/job.types';

function toRecord(job: Job): JobRecord {
  return {
    id: job.id,
    projectId: job.projectId,
    userId: job.userId,
    type: job.type,
    status: job.status,
    priority: job.priority,
    payload: job.payload,
    result: job.result,
    progress: job.progress,
    progressMessage: job.progressMessage,
    attemptCount: job.attemptCount,
    maxAttempts: job.maxAttempts,
    scheduledAt: job.scheduledAt,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    failedAt: job.failedAt,
    cancelledAt: job.cancelledAt,
    cancelRequestedAt: job.cancelRequestedAt,
    errorCode: job.errorCode,
    errorMessage: job.errorMessage,
    idempotencyKey: job.idempotencyKey,
    parentJobId: job.parentJobId,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}

function toEventRecord(event: {
  id: string;
  jobId: string;
  type: JobEventType;
  message: string | null;
  metadata: unknown;
  createdAt: Date;
}): JobEventRecord {
  return {
    id: event.id,
    jobId: event.jobId,
    type: event.type,
    message: event.message,
    metadata: event.metadata,
    createdAt: event.createdAt,
  };
}

function byteSize(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value ?? null), 'utf8');
}

// Payloads are always server-constructed (never arbitrary client JSON — see
// CreateJobDto), so a JSON.stringify comparison is sufficient here: the same
// code path builds the same payload the same way every time, so key-order
// drift isn't a real-world concern.
function payloadsEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

function isUniqueConstraintViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}

// Enqueue/read/cancel surface for the durable job queue. Claiming and
// execution live in JobWorkerService — this service never runs a handler.
@Injectable()
export class JobService {
  private readonly logger = new Logger(JobService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly projectsService: ProjectsService,
    private readonly approvalService: ApprovalService,
    private readonly config: JobsConfigService,
  ) {}

  // ---- enqueue -----------------------------------------------------

  async enqueue(params: EnqueueJobParams): Promise<JobRecord> {
    const payload = params.payload ?? {};
    this.assertPayloadSize(payload);

    if (JOB_TYPE_REQUIRES_DEVELOPMENT_APPROVAL[params.type]) {
      if (!params.projectId) {
        throw mapJobErrorToHttpException(
          new JobError({
            code: JobErrorCode.INVALID_PAYLOAD,
            message: `${params.type} requires a projectId.`,
          }),
        );
      }
      try {
        await this.approvalService.assertDevelopmentApproved(params.projectId);
      } catch (error) {
        if (error instanceof ApprovalError) {
          throw mapApprovalErrorToHttpException(error);
        }
        throw error;
      }
    }

    if (params.idempotencyKey) {
      const existing = await this.findIdempotentJob(
        params.type,
        params.projectId ?? null,
        params.idempotencyKey,
      );
      if (existing) {
        return this.reconcileIdempotentJob(existing, payload);
      }
    }

    let created: Job;
    try {
      created = await this.prisma.$transaction(async (tx) => {
        const job = await tx.job.create({
          data: {
            type: params.type,
            projectId: params.projectId ?? null,
            userId: params.userId ?? null,
            payload: payload as Prisma.InputJsonValue,
            priority: params.priority ?? 0,
            scheduledAt: params.scheduledAt ?? new Date(),
            maxAttempts: params.maxAttempts ?? this.config.defaultMaxAttempts,
            idempotencyKey: params.idempotencyKey ?? null,
          },
        });
        await tx.jobEvent.create({
          data: {
            jobId: job.id,
            type: JobEventType.CREATED,
            metadata: { type: job.type, priority: job.priority },
          },
        });
        return job;
      });
    } catch (error) {
      if (isUniqueConstraintViolation(error) && params.idempotencyKey) {
        // Lost a race against a concurrent identical enqueue.
        const existing = await this.findIdempotentJob(
          params.type,
          params.projectId ?? null,
          params.idempotencyKey,
        );
        if (existing) {
          return this.reconcileIdempotentJob(existing, payload);
        }
      }
      throw error;
    }

    this.logger.log(
      `Job enqueued (jobId=${created.id}, type=${created.type}, projectId=${created.projectId ?? 'none'})`,
    );
    return toRecord(created);
  }

  // Public API entry point: verifies project ownership, then builds
  // whatever internal payload the given type needs. The client never
  // supplies a payload directly (see CreateJobDto).
  async enqueuePublic(
    userId: string,
    projectId: string,
    type: JobType,
  ): Promise<JobRecord> {
    await this.projectsService.findOneForUser(userId, projectId);
    return this.enqueue({ type, projectId, userId, payload: {} });
  }

  private async findIdempotentJob(
    type: JobType,
    projectId: string | null,
    idempotencyKey: string,
  ): Promise<Job | null> {
    return this.prisma.job.findFirst({
      where: { type, projectId, idempotencyKey },
    });
  }

  private reconcileIdempotentJob(existing: Job, payload: unknown): JobRecord {
    if (!payloadsEqual(existing.payload, payload)) {
      throw mapJobErrorToHttpException(
        new JobError({
          code: JobErrorCode.IDEMPOTENCY_CONFLICT,
          message:
            'An existing job with this idempotency key has a different payload.',
        }),
      );
    }
    return toRecord(existing);
  }

  private assertPayloadSize(payload: unknown): void {
    if (byteSize(payload) > this.config.maxPayloadBytes) {
      throw mapJobErrorToHttpException(
        new JobError({
          code: JobErrorCode.PAYLOAD_TOO_LARGE,
          message: `Job payload exceeds the ${this.config.maxPayloadBytes}-byte limit.`,
        }),
      );
    }
  }

  // ---- reads ---------------------------------------------------------

  async list(
    userId: string,
    projectId: string,
    filters: { status?: JobStatus; type?: JobType; limit?: number },
  ): Promise<JobRecord[]> {
    await this.projectsService.findOneForUser(userId, projectId);
    const take = Math.min(Math.max(filters.limit ?? 50, 1), 100);
    const jobs = await this.prisma.job.findMany({
      where: {
        projectId,
        ...(filters.status ? { status: filters.status } : {}),
        ...(filters.type ? { type: filters.type } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take,
    });
    return jobs.map(toRecord);
  }

  async getById(
    userId: string,
    projectId: string,
    jobId: string,
  ): Promise<JobRecord> {
    await this.projectsService.findOneForUser(userId, projectId);
    const job = await this.prisma.job.findFirst({
      where: { id: jobId, projectId },
    });
    if (!job) {
      throw new NotFoundException('Job not found.');
    }
    return toRecord(job);
  }

  async getEvents(
    userId: string,
    projectId: string,
    jobId: string,
  ): Promise<JobEventRecord[]> {
    await this.projectsService.findOneForUser(userId, projectId);
    const job = await this.prisma.job.findFirst({
      where: { id: jobId, projectId },
      select: { id: true },
    });
    if (!job) {
      throw new NotFoundException('Job not found.');
    }
    const events = await this.prisma.jobEvent.findMany({
      where: { jobId },
      orderBy: { createdAt: 'asc' },
    });
    return events.map(toEventRecord);
  }

  // ---- cancellation ----------------------------------------------------

  async cancel(
    userId: string,
    projectId: string,
    jobId: string,
  ): Promise<JobRecord> {
    await this.projectsService.findOneForUser(userId, projectId);
    const job = await this.prisma.job.findFirst({
      where: { id: jobId, projectId },
    });
    if (!job) {
      throw new NotFoundException('Job not found.');
    }

    if (job.status === JobStatus.CANCELLED) {
      return toRecord(job); // idempotent
    }

    if (!isValidJobTransition(job.status, JobStatus.CANCELLED)) {
      throw mapJobErrorToHttpException(
        new JobError({
          code: JobErrorCode.NOT_CANCELLABLE,
          message: `Cannot cancel a job that already ${
            job.status === JobStatus.SUCCEEDED ? 'succeeded' : 'failed'
          }.`,
        }),
      );
    }

    if (
      job.status === JobStatus.QUEUED ||
      job.status === JobStatus.RETRY_WAIT
    ) {
      await this.prisma.$transaction(async (tx) => {
        const updated = await tx.job.updateMany({
          where: { id: jobId, status: job.status },
          data: { status: JobStatus.CANCELLED, cancelledAt: new Date() },
        });
        if (updated.count === 1) {
          await tx.jobEvent.create({
            data: { jobId, type: JobEventType.CANCELLED },
          });
        }
      });
      return toRecord(
        await this.prisma.job.findUniqueOrThrow({ where: { id: jobId } }),
      );
    }

    if (job.status === JobStatus.RUNNING) {
      if (job.cancelRequestedAt) {
        return toRecord(job); // already requested — idempotent no-op
      }
      await this.prisma.$transaction(async (tx) => {
        const updated = await tx.job.updateMany({
          where: {
            id: jobId,
            status: JobStatus.RUNNING,
            cancelRequestedAt: null,
          },
          data: { cancelRequestedAt: new Date() },
        });
        if (updated.count === 1) {
          await tx.jobEvent.create({
            data: { jobId, type: JobEventType.CANCEL_REQUESTED },
          });
        }
      });
      return toRecord(
        await this.prisma.job.findUniqueOrThrow({ where: { id: jobId } }),
      );
    }

    // Unreachable given isValidJobTransition above (only QUEUED/RETRY_WAIT/
    // RUNNING can ever transition to CANCELLED) — kept as a defensive
    // fallback so this never silently returns undefined if JobStatus grows.
    throw mapJobErrorToHttpException(
      new JobError({
        code: JobErrorCode.NOT_CANCELLABLE,
        message: `Cannot cancel a job in status ${job.status}.`,
      }),
    );
  }

  // ---- worker-facing primitives (used by JobWorkerService) --------------

  async isCancellationRequested(jobId: string): Promise<boolean> {
    const job = await this.prisma.job.findUnique({
      where: { id: jobId },
      select: { cancelRequestedAt: true },
    });
    return job?.cancelRequestedAt != null;
  }

  async recordProgress(
    jobId: string,
    percent: number,
    message?: string,
  ): Promise<void> {
    const clamped = Math.max(0, Math.min(100, Math.round(percent)));
    const current = await this.prisma.job.findUnique({
      where: { id: jobId },
      select: { progress: true, progressMessage: true },
    });
    if (!current) return;

    await this.prisma.job.update({
      where: { id: jobId },
      data: {
        progress: clamped,
        progressMessage: message ?? current.progressMessage,
      },
    });

    // Avoid event spam: only record a PROGRESS event on a meaningful change
    // (crossing a 10% boundary, or an actual message update).
    const crossedDecile =
      Math.floor(clamped / 10) !== Math.floor((current.progress ?? 0) / 10);
    const messageChanged =
      message !== undefined && message !== current.progressMessage;
    if (crossedDecile || messageChanged) {
      await this.prisma.jobEvent.create({
        data: {
          jobId,
          type: JobEventType.PROGRESS,
          message: message ?? null,
          metadata: { percent: clamped },
        },
      });
    }
  }

  async heartbeat(jobId: string, workerId: string): Promise<boolean> {
    const lockExpiresAt = new Date(
      Date.now() + this.config.lockTimeoutSeconds * 1000,
    );
    const updated = await this.prisma.job.updateMany({
      where: { id: jobId, status: JobStatus.RUNNING, lockedBy: workerId },
      data: { lockExpiresAt },
    });
    return updated.count === 1;
  }

  toPublicRecord(job: Job): JobRecord {
    return toRecord(job);
  }
}
