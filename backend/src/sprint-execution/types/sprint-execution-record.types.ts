import { SprintExecutionStatus, SprintStatus } from '@prisma/client';
import { SprintExecutionErrorCode } from '../errors/sprint-execution.error';
import { JobRecord } from '../../jobs/types/job.types';

// Public-facing shape of a SprintExecution — never exposes an absolute
// workspace path (matches TaskExecutionRecord/ValidationAttemptRecord).
export interface SprintExecutionRecord {
  id: string;
  projectId: string;
  sprintId: string;
  sprintPlanId: string;
  attempt: number;
  status: SprintExecutionStatus;
  currentTaskId: string | null;
  // Unlike TaskExecutionRecord/ValidationAttemptRecord, this IS exposed —
  // the frontend needs it to recover live progress/cancel-ability after a
  // page reload mid-Sprint (item 128), and a Job id carries no sensitive
  // information on its own (the underlying Job endpoints are already
  // ownership-gated).
  backgroundJobId: string | null;
  totalTasks: number;
  passedTasks: number;
  failedTasks: number;
  blockedTasks: number;
  repositoryStartSha: string | null;
  repositoryEndSha: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface SprintExecutionEligibilityResult {
  runnable: boolean;
  reasons: SprintExecutionErrorCode[];
  sprint: { id: string; status: SprintStatus };
}

export interface RunSprintResult {
  sprintExecution: SprintExecutionRecord;
  job: JobRecord;
}
