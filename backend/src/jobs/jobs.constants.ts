import { JobType, JobStatus } from '@prisma/client';

export const JOB_HANDLERS = Symbol('JOB_HANDLERS');

// Centralized so no code path can silently invent a new transition.
// SUCCEEDED/FAILED/CANCELLED are terminal — nothing transitions out of them.
export const JOB_TRANSITIONS: Record<JobStatus, JobStatus[]> = {
  [JobStatus.QUEUED]: [JobStatus.RUNNING, JobStatus.CANCELLED],
  [JobStatus.RETRY_WAIT]: [JobStatus.RUNNING, JobStatus.CANCELLED],
  [JobStatus.RUNNING]: [
    JobStatus.SUCCEEDED,
    JobStatus.FAILED,
    JobStatus.RETRY_WAIT,
    JobStatus.CANCELLED,
  ],
  [JobStatus.SUCCEEDED]: [],
  [JobStatus.FAILED]: [],
  [JobStatus.CANCELLED]: [],
};

export function isValidJobTransition(from: JobStatus, to: JobStatus): boolean {
  return JOB_TRANSITIONS[from].includes(to);
}

// Sprint 7 integration point: any job type that performs real
// development-adjacent work must not run until Start Development has been
// explicitly approved. SYSTEM_TEST is pure infrastructure validation and is
// deliberately exempt.
export const JOB_TYPE_REQUIRES_DEVELOPMENT_APPROVAL: Record<JobType, boolean> =
  {
    [JobType.SYSTEM_TEST]: false,
    [JobType.PROJECT_PREPARATION]: true,
  };

// Only PROJECT_PREPARATION is reachable through the public API — SYSTEM_TEST
// is infrastructure-validation only, enqueued directly via JobService in
// tests/internal callers, never accepted from a client.
export const PUBLICLY_ENQUEUABLE_JOB_TYPES: JobType[] = [
  JobType.PROJECT_PREPARATION,
];
