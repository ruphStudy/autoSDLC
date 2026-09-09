export type SprintExecutionStatus =
  | 'QUEUED'
  | 'RUNNING'
  | 'PAUSED'
  | 'COMPLETED'
  | 'FAILED'
  | 'BLOCKED'
  | 'CANCELLED';

// Mirrors the backend's SprintExecutionRecord — owner-scoped only, never an
// absolute workspace path.
export interface SprintExecution {
  id: string;
  projectId: string;
  sprintId: string;
  sprintPlanId: string;
  attempt: number;
  status: SprintExecutionStatus;
  currentTaskId: string | null;
  backgroundJobId: string | null;
  totalTasks: number;
  passedTasks: number;
  failedTasks: number;
  blockedTasks: number;
  repositoryStartSha: string | null;
  repositoryEndSha: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SprintExecutionEligibility {
  runnable: boolean;
  reasons: string[];
  sprint: { id: string; status: string };
}

// A SprintExecution the UI should keep polling for — not yet terminal.
export const ACTIVE_SPRINT_EXECUTION_STATUSES: SprintExecutionStatus[] = [
  'QUEUED',
  'RUNNING',
  'PAUSED',
];
