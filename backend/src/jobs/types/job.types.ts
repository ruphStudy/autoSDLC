import { JobEventType, JobStatus, JobType } from '@prisma/client';

// Public-facing shape of a Job — deliberately excludes lock internals
// (lockedAt/lockedBy/lockExpiresAt), which are worker/recovery-only.
export interface JobRecord {
  id: string;
  projectId: string | null;
  userId: string | null;
  type: JobType;
  status: JobStatus;
  priority: number;
  payload: unknown;
  result: unknown;
  progress: number;
  progressMessage: string | null;
  attemptCount: number;
  maxAttempts: number;
  scheduledAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  failedAt: Date | null;
  cancelledAt: Date | null;
  cancelRequestedAt: Date | null;
  errorCode: string | null;
  errorMessage: string | null;
  idempotencyKey: string | null;
  parentJobId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface JobEventRecord {
  id: string;
  jobId: string;
  type: JobEventType;
  message: string | null;
  metadata: unknown;
  createdAt: Date;
}

export interface EnqueueJobParams {
  type: JobType;
  projectId?: string | null;
  userId?: string | null;
  payload?: unknown;
  priority?: number;
  scheduledAt?: Date;
  maxAttempts?: number;
  idempotencyKey?: string;
}

// Everything a handler is given to do its work. No framework coupling
// beyond these plain async methods — a handler never touches Prisma,
// HTTP, or the worker directly.
export interface JobExecutionContext<TPayload = unknown> {
  readonly jobId: string;
  readonly projectId: string | null;
  readonly userId: string | null;
  readonly attemptCount: number;
  readonly maxAttempts: number;
  readonly payload: TPayload;
  reportProgress(percent: number, message?: string): Promise<void>;
  isCancellationRequested(): Promise<boolean>;
  heartbeat(): Promise<void>;
}

export interface JobHandlerResult<TResult = unknown> {
  result?: TResult;
}

export interface JobHandler<TPayload = unknown, TResult = unknown> {
  readonly type: JobType;
  execute(
    context: JobExecutionContext<TPayload>,
  ): Promise<JobHandlerResult<TResult> | void>;
}
