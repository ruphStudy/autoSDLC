import type { TaskStatus } from '../sprint-planning/types';

export type TaskExecutionStatus =
  | 'QUEUED'
  | 'RUNNING'
  | 'AGENT_COMPLETED'
  | 'READY_FOR_VALIDATION'
  | 'FAILED'
  | 'CANCELLED';

export interface TaskExecutionChangedFile {
  path: string;
  changeType: 'ADDED' | 'MODIFIED' | 'DELETED' | 'RENAMED' | 'UNTRACKED';
}

// Mirrors the backend's TaskExecutionRecord — owner-scoped only, no
// workspace path or instruction text (that lives on TaskInstruction).
export interface TaskExecution {
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
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface TaskEligibility {
  runnable: boolean;
  reasons: string[];
  task: { id: string; status: TaskStatus };
}

// A TaskExecution the UI should keep polling for — not yet in a terminal
// state (mirrors ACTIVE_JOB_STATUSES/ACTIVE_AGENT_JOB_STATUSES).
export const ACTIVE_TASK_EXECUTION_STATUSES: TaskExecutionStatus[] = [
  'QUEUED',
  'RUNNING',
  'AGENT_COMPLETED',
];
