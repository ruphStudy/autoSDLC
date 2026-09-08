export type JobType = 'SYSTEM_TEST' | 'PROJECT_PREPARATION';

export type JobStatus =
  | 'QUEUED'
  | 'RUNNING'
  | 'RETRY_WAIT'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'CANCELLED';

export type JobEventType =
  | 'CREATED'
  | 'CLAIMED'
  | 'STARTED'
  | 'PROGRESS'
  | 'RETRY_SCHEDULED'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'CANCEL_REQUESTED'
  | 'CANCELLED'
  | 'LOCK_RECOVERED';

// Mirrors the backend's JobRecord — deliberately excludes lock internals.
export interface Job {
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
  scheduledAt: string;
  startedAt: string | null;
  completedAt: string | null;
  failedAt: string | null;
  cancelledAt: string | null;
  cancelRequestedAt: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  idempotencyKey: string | null;
  parentJobId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface JobEvent {
  id: string;
  jobId: string;
  type: JobEventType;
  message: string | null;
  metadata: unknown;
  createdAt: string;
}

// A job the UI should keep polling for — not yet in a terminal state.
export const ACTIVE_JOB_STATUSES: JobStatus[] = ['QUEUED', 'RUNNING', 'RETRY_WAIT'];
