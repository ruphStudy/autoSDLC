import { TaskExecutionStatus, TaskStatus } from '@prisma/client';
import { TaskExecutionErrorCode } from '../errors/task-execution.error';
import { JobRecord } from '../../jobs/types/job.types';
import { ChangedFileStatus } from '../../workspace/git/git.types';

export interface TaskExecutionChangedFile {
  path: string;
  changeType: ChangedFileStatus;
}

// Public-facing shape of a TaskExecution. Deliberately excludes
// priorTaskStatus (internal rollback bookkeeping) and backgroundJobId (the
// generic Job id is already reachable via the enqueue response / job list —
// see AgentJobRecord, which excludes it for the same reason).
export interface TaskExecutionRecord {
  id: string;
  projectId: string;
  taskId: string;
  attempt: number;
  status: TaskExecutionStatus;
  taskInstructionId: string | null;
  agentJobId: string | null;
  repositoryStartSha: string | null;
  repositoryEndSha: string | null;
  changedFiles: TaskExecutionChangedFile[];
  gitDiff: string | null;
  gitDiffTruncated: boolean;
  errorCode: string | null;
  errorMessage: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  durationMs: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface TaskEligibilityResult {
  runnable: boolean;
  reasons: TaskExecutionErrorCode[];
  task: { id: string; status: TaskStatus };
}

export interface RunTaskResult {
  taskExecution: TaskExecutionRecord;
  job: JobRecord;
  task: { id: string; status: TaskStatus };
}
