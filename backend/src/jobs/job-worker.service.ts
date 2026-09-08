import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Job, JobEventType, JobStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { JobService } from './job.service';
import { JobHandlerRegistry } from './job-handler.registry';
import { JobsConfigService } from './jobs.config';
import { computeBackoffSeconds } from './utils/backoff';
import { JobCancelledError, JobExecutionError } from './errors/job.error';
import { JobExecutionContext } from './types/job.types';

interface NormalizedExecutionError {
  code: string;
  message: string;
  retryable: boolean;
}

// Every DateTime column here is `timestamp` (no time zone). Prisma's own
// query builder always stores these as naive UTC wall-clock text and reads
// them back correctly — but binding a plain JS Date directly into a raw
// $queryRaw template does not: the engine round-trips it through the
// session's TimeZone GUC (e.g. Asia/Kolkata), silently shifting every
// value by the session's UTC offset. Casting through `timestamptz AT TIME
// ZONE 'UTC'` reproduces the exact same naive-UTC convention Prisma itself
// uses, so raw writes and normal Prisma writes/reads agree.
function utcTimestamp(date: Date): Prisma.Sql {
  return Prisma.sql`(${date.toISOString()}::timestamptz AT TIME ZONE 'UTC')`;
}

// Builds the concrete context handed to a handler for one execution
// attempt. Every method delegates back through JobService so a handler
// never touches Prisma or the worker directly.
class RunningJobContext<TPayload> implements JobExecutionContext<TPayload> {
  constructor(
    private readonly jobService: JobService,
    readonly jobId: string,
    readonly projectId: string | null,
    readonly userId: string | null,
    readonly attemptCount: number,
    readonly maxAttempts: number,
    readonly payload: TPayload,
    private readonly workerId: string,
  ) {}

  async reportProgress(percent: number, message?: string): Promise<void> {
    await this.jobService.recordProgress(this.jobId, percent, message);
  }

  async isCancellationRequested(): Promise<boolean> {
    return this.jobService.isCancellationRequested(this.jobId);
  }

  async heartbeat(): Promise<void> {
    await this.jobService.heartbeat(this.jobId, this.workerId);
  }
}

// Generic execution loop: claim a batch, resolve each job's handler,
// execute, persist the outcome. No job-type-specific logic lives here —
// that belongs entirely to the registered JobHandler.
@Injectable()
export class JobWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(JobWorkerService.name);
  readonly workerId: string;

  private timer: NodeJS.Timeout | null = null;
  private currentCycle: Promise<void> | null = null;
  private shuttingDown = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jobService: JobService,
    private readonly registry: JobHandlerRegistry,
    private readonly config: JobsConfigService,
  ) {
    this.workerId = `${hostname()}-${process.pid}-${randomUUID().slice(0, 8)}`;
  }

  onModuleInit(): void {
    // Never auto-poll under test — a live interval would keep Jest's
    // process alive and hang the run. Deterministic tests call runOnce()
    // directly instead.
    if (!this.config.workerEnabled || this.config.isTestEnv) {
      return;
    }
    this.timer = setInterval(() => {
      this.currentCycle = this.runOnce().catch((error) => {
        this.logger.error(
          'Job worker poll cycle failed',
          error instanceof Error ? error.stack : undefined,
        );
      });
    }, this.config.pollIntervalMs);
    this.timer.unref?.();
    this.logger.log(`Job worker started (workerId=${this.workerId})`);
  }

  async onModuleDestroy(): Promise<void> {
    this.shuttingDown = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.currentCycle) {
      await this.currentCycle;
    }
  }

  // The single deterministic entry point both the real poller and tests
  // use: recover stale locks, claim a bounded batch, execute it.
  async runOnce(): Promise<void> {
    if (this.shuttingDown) return;
    await this.recoverStaleLocks();
    if (this.shuttingDown) return;
    const claimed = await this.claimBatch(this.config.batchSize);
    for (const job of claimed) {
      await this.executeJob(job);
    }
  }

  // ---- claiming ----------------------------------------------------

  // Single atomic statement: the inner SELECT ... FOR UPDATE SKIP LOCKED
  // means two concurrent workers running this simultaneously always lock
  // disjoint rows — no separate transaction wrapper needed, Postgres treats
  // one statement as atomic already.
  async claimBatch(limit: number): Promise<Job[]> {
    const now = utcTimestamp(new Date());
    const lockExpiresAt = utcTimestamp(
      new Date(Date.now() + this.config.lockTimeoutSeconds * 1000),
    );
    const rows = await this.prisma.$queryRaw<Job[]>`
      WITH claimable AS (
        SELECT id FROM "jobs"
        WHERE status IN ('QUEUED', 'RETRY_WAIT')
          AND "scheduledAt" <= ${now}
        ORDER BY priority DESC, "scheduledAt" ASC, "createdAt" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT ${limit}
      )
      UPDATE "jobs"
      SET status = 'RUNNING',
          "lockedAt" = ${now},
          "lockedBy" = ${this.workerId},
          "lockExpiresAt" = ${lockExpiresAt},
          "startedAt" = COALESCE("startedAt", ${now}),
          "attemptCount" = "attemptCount" + 1,
          "updatedAt" = ${now}
      FROM claimable
      WHERE "jobs".id = claimable.id
      RETURNING "jobs".*;
    `;

    if (rows.length > 0) {
      await this.prisma.jobEvent.createMany({
        data: rows.map((job) => ({
          jobId: job.id,
          type: JobEventType.CLAIMED,
          metadata: { workerId: this.workerId, attemptCount: job.attemptCount },
        })),
      });
    }
    return rows;
  }

  // ---- stale lock recovery ----------------------------------------------

  async recoverStaleLocks(): Promise<void> {
    const stale = await this.prisma.job.findMany({
      where: { status: JobStatus.RUNNING, lockExpiresAt: { lt: new Date() } },
      select: { id: true, attemptCount: true, maxAttempts: true },
    });

    for (const job of stale) {
      const exhausted = job.attemptCount >= job.maxAttempts;
      await this.prisma.$transaction(async (tx) => {
        if (exhausted) {
          const updated = await tx.job.updateMany({
            where: {
              id: job.id,
              status: JobStatus.RUNNING,
              lockExpiresAt: { lt: new Date() },
            },
            data: {
              status: JobStatus.FAILED,
              failedAt: new Date(),
              errorCode: 'job_stale_lock_exhausted',
              errorMessage: 'Worker lock expired and no attempts remain.',
              lockedAt: null,
              lockedBy: null,
              lockExpiresAt: null,
            },
          });
          if (updated.count === 0) return;
          await tx.jobEvent.create({
            data: {
              jobId: job.id,
              type: JobEventType.LOCK_RECOVERED,
              metadata: { recoveredTo: 'FAILED' },
            },
          });
          await tx.jobEvent.create({
            data: {
              jobId: job.id,
              type: JobEventType.FAILED,
              message: 'Worker lock expired and no attempts remain.',
            },
          });
        } else {
          const delaySeconds = computeBackoffSeconds(
            job.attemptCount,
            this.config.retryBaseDelaySeconds,
            this.config.retryMaxDelaySeconds,
          );
          const scheduledAt = new Date(Date.now() + delaySeconds * 1000);
          const updated = await tx.job.updateMany({
            where: {
              id: job.id,
              status: JobStatus.RUNNING,
              lockExpiresAt: { lt: new Date() },
            },
            data: {
              status: JobStatus.RETRY_WAIT,
              scheduledAt,
              lockedAt: null,
              lockedBy: null,
              lockExpiresAt: null,
            },
          });
          if (updated.count === 0) return;
          await tx.jobEvent.create({
            data: {
              jobId: job.id,
              type: JobEventType.LOCK_RECOVERED,
              metadata: { recoveredTo: 'RETRY_WAIT' },
            },
          });
          await tx.jobEvent.create({
            data: {
              jobId: job.id,
              type: JobEventType.RETRY_SCHEDULED,
              metadata: { delaySeconds, scheduledAt },
            },
          });
        }
      });
      this.logger.warn(
        `Recovered stale job lock (jobId=${job.id}, recoveredTo=${exhausted ? 'FAILED' : 'RETRY_WAIT'})`,
      );
    }
  }

  // ---- execution -----------------------------------------------------

  private async executeJob(job: Job): Promise<void> {
    const startedAt = Date.now();
    const handler = this.registry.resolve(job.type);
    if (!handler) {
      await this.markFailed(job.id, {
        code: 'job_unknown_handler',
        message: `No handler registered for job type ${job.type}.`,
      });
      this.logger.warn(
        `No handler registered (jobId=${job.id}, type=${job.type})`,
      );
      return;
    }

    const context = new RunningJobContext(
      this.jobService,
      job.id,
      job.projectId,
      job.userId,
      job.attemptCount,
      job.maxAttempts,
      job.payload,
      this.workerId,
    );

    try {
      const outcome = await handler.execute(context);
      const result = outcome ? (outcome.result ?? null) : null;
      await this.markSucceeded(job.id, result);
      this.logger.log(
        `Job succeeded (jobId=${job.id}, type=${job.type}, workerId=${this.workerId}, attempt=${job.attemptCount}, durationMs=${Date.now() - startedAt})`,
      );
    } catch (error) {
      if (error instanceof JobCancelledError) {
        await this.markCancelled(job.id);
        this.logger.log(
          `Job cancelled cooperatively (jobId=${job.id}, workerId=${this.workerId})`,
        );
        return;
      }

      const normalized = this.normalizeExecutionError(error);
      const attemptsRemain = job.attemptCount < job.maxAttempts;
      if (normalized.retryable && attemptsRemain) {
        await this.scheduleRetry(job.id, job.attemptCount, normalized);
        this.logger.warn(
          `Job scheduled for retry (jobId=${job.id}, attempt=${job.attemptCount}, code=${normalized.code})`,
        );
      } else {
        await this.markFailed(job.id, normalized);
        this.logger.warn(
          `Job failed (jobId=${job.id}, attempt=${job.attemptCount}, code=${normalized.code}, retryable=${normalized.retryable})`,
        );
      }
    }
  }

  private normalizeExecutionError(error: unknown): NormalizedExecutionError {
    if (error instanceof JobExecutionError) {
      return {
        code: error.code,
        message: error.message,
        retryable: error.retryable,
      };
    }
    if (error instanceof Error) {
      // Unknown errors default to non-retryable — never retry blindly.
      return {
        code: 'job_unknown_error',
        message: error.message,
        retryable: false,
      };
    }
    return {
      code: 'job_unknown_error',
      message: 'An unknown error occurred.',
      retryable: false,
    };
  }

  // ---- guarded terminal transitions --------------------------------------
  // Each is scoped to (id, status=RUNNING, lockedBy=this worker) so a
  // worker that lost ownership (e.g. stale-recovered mid-execution by
  // someone else) silently no-ops instead of corrupting a state someone
  // else already resolved.

  private async markSucceeded(jobId: string, result: unknown): Promise<void> {
    const size = Buffer.byteLength(JSON.stringify(result ?? null), 'utf8');
    if (size > this.config.maxResultBytes) {
      await this.markFailed(jobId, {
        code: 'job_result_too_large',
        message: `Job result exceeds the ${this.config.maxResultBytes}-byte limit.`,
      });
      return;
    }

    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.job.updateMany({
        where: {
          id: jobId,
          status: JobStatus.RUNNING,
          lockedBy: this.workerId,
        },
        data: {
          status: JobStatus.SUCCEEDED,
          result: (result ?? Prisma.JsonNull) as Prisma.InputJsonValue,
          completedAt: new Date(),
          progress: 100,
          lockedAt: null,
          lockedBy: null,
          lockExpiresAt: null,
        },
      });
      if (updated.count === 0) return;
      await tx.jobEvent.create({
        data: { jobId, type: JobEventType.SUCCEEDED },
      });
    });
  }

  private async markFailed(
    jobId: string,
    error: { code: string; message: string },
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.job.updateMany({
        where: {
          id: jobId,
          status: JobStatus.RUNNING,
          lockedBy: this.workerId,
        },
        data: {
          status: JobStatus.FAILED,
          errorCode: error.code,
          errorMessage: error.message,
          failedAt: new Date(),
          lockedAt: null,
          lockedBy: null,
          lockExpiresAt: null,
        },
      });
      if (updated.count === 0) return;
      await tx.jobEvent.create({
        data: {
          jobId,
          type: JobEventType.FAILED,
          message: error.message,
          metadata: { code: error.code },
        },
      });
    });
  }

  private async scheduleRetry(
    jobId: string,
    attemptCount: number,
    error: { code: string; message: string },
  ): Promise<void> {
    const delaySeconds = computeBackoffSeconds(
      attemptCount,
      this.config.retryBaseDelaySeconds,
      this.config.retryMaxDelaySeconds,
    );
    const scheduledAt = new Date(Date.now() + delaySeconds * 1000);

    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.job.updateMany({
        where: {
          id: jobId,
          status: JobStatus.RUNNING,
          lockedBy: this.workerId,
        },
        data: {
          status: JobStatus.RETRY_WAIT,
          scheduledAt,
          errorCode: error.code,
          errorMessage: error.message,
          lockedAt: null,
          lockedBy: null,
          lockExpiresAt: null,
        },
      });
      if (updated.count === 0) return;
      await tx.jobEvent.create({
        data: {
          jobId,
          type: JobEventType.RETRY_SCHEDULED,
          message: error.message,
          metadata: { code: error.code, delaySeconds, scheduledAt },
        },
      });
    });
  }

  private async markCancelled(jobId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.job.updateMany({
        where: {
          id: jobId,
          status: JobStatus.RUNNING,
          lockedBy: this.workerId,
        },
        data: {
          status: JobStatus.CANCELLED,
          cancelledAt: new Date(),
          lockedAt: null,
          lockedBy: null,
          lockExpiresAt: null,
        },
      });
      if (updated.count === 0) return;
      await tx.jobEvent.create({
        data: { jobId, type: JobEventType.CANCELLED },
      });
    });
  }
}
