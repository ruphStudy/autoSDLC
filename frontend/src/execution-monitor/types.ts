export type ExecutionPhase =
  | 'IDLE'
  | 'QUEUED'
  | 'PREPARING'
  | 'GENERATING_INSTRUCTION'
  | 'CODING'
  | 'CAPTURING_CHANGES'
  | 'VALIDATING'
  | 'COMMITTING'
  | 'PAUSED'
  | 'BLOCKED'
  | 'FAILED'
  | 'COMPLETED'
  | 'CANCELLED';

export type EventSeverity = 'INFO' | 'SUCCESS' | 'WARNING' | 'ERROR';
export type EventScope = 'PROJECT' | 'SPRINT' | 'TASK' | 'AGENT' | 'VALIDATION' | 'GIT';

export interface WorkspaceSummary {
  status: string;
  branch: string | null;
  clean: boolean | null;
  headCommitSha: string | null;
}

export interface TaskPipelineEntry {
  id: string;
  key: string;
  title: string;
  status: string;
  commitSha: string | null;
}

export interface SprintProgressSummary {
  sprintId: string;
  number: number;
  title: string;
  objective: string;
  status: string;
  totalTasks: number;
  passedTasks: number;
  runningTasks: number;
  reviewingTasks: number;
  failedTasks: number;
  blockedTasks: number;
  remainingTasks: number;
  progressPercent: number;
}

export interface ActiveSprintExecutionSummary {
  id: string;
  sprintId: string;
  sprintNumber: number;
  sprintTitle: string;
  sprintObjective: string;
  attempt: number;
  status: string;
  currentPhase: ExecutionPhase;
  progressPercent: number;
  totalTasks: number;
  passedTasks: number;
  currentTaskId: string | null;
  pauseRequested: boolean;
  startedAt: string | null;
  completedAt: string | null;
  repositoryStartSha: string | null;
  repositoryEndSha: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  isLive: boolean;
  tasks: TaskPipelineEntry[];
  backgroundJobId: string | null;
}

export interface CurrentTaskSummary {
  id: string;
  key: string;
  title: string;
  status: string;
  executionAttempt: number | null;
  executionStatus: string | null;
  instructionVersion: number | null;
  changedFileCount: number;
  startedAt: string | null;
  durationMs: number | null;
}

export interface AgentActivitySummary {
  id: string;
  provider: string;
  model: string | null;
  status: string;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  turns: number | null;
  changedFileCount: number;
  toolActivityCounts: Record<string, number>;
  commandActivityCount: number;
  summary: string | null;
  errorCode: string | null;
  errorMessage: string | null;
}

export interface ValidationCheckSummary {
  type: string;
  name: string;
  required: boolean;
  status: string;
  durationMs: number | null;
  exitCode: number | null;
}

export interface ValidationActivitySummary {
  id: string;
  attempt: number;
  status: string;
  requiredPassed: number;
  requiredFailed: number;
  optionalPassed: number;
  optionalFailed: number;
  checks: ValidationCheckSummary[];
  commitSha: string | null;
  errorCode: string | null;
  errorMessage: string | null;
}

export interface UsageTotals {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface ExecutionUsageSummary {
  codingAgent: UsageTotals;
  planningAi: UsageTotals;
}

export interface CommitHistoryEntry {
  taskId: string;
  taskKey: string;
  taskTitle: string;
  commitSha: string;
  committedAt: string | null;
  validationAttempt: number | null;
  changedFileCount: number | null;
}

export interface ExecutionTimelineEvent {
  id: string;
  type: string;
  timestamp: string;
  scope: EventScope;
  title: string;
  description?: string;
  status?: string;
  severity: EventSeverity;
  sprintId?: string;
  taskId?: string;
  taskKey?: string;
  metadata?: Record<string, unknown>;
}

export interface NextSprintSummary {
  sprintId: string;
  number: number;
  title: string;
}

export interface ProjectExecutionOverview {
  projectId: string;
  projectStatus: string;
  archived: boolean;
  workspace: WorkspaceSummary;
  hasActiveExecution: boolean;
  activeSprintExecution: ActiveSprintExecutionSummary | null;
  currentTask: CurrentTaskSummary | null;
  agent: AgentActivitySummary | null;
  validation: ValidationActivitySummary | null;
  sprintProgress: SprintProgressSummary[];
  usage: ExecutionUsageSummary;
  recentCommits: CommitHistoryEntry[];
  recentEvents: ExecutionTimelineEvent[];
  nextSprintEligible: NextSprintSummary | null;
}

export interface ExecutionHistoryEntry {
  id: string;
  sprintId: string;
  sprintNumber: number;
  sprintTitle: string;
  attempt: number;
  status: string;
  startedAt: string | null;
  completedAt: string | null;
  totalTasks: number;
  passedTasks: number;
  repositoryStartSha: string | null;
  repositoryEndSha: string | null;
  errorCode: string | null;
  errorMessage: string | null;
}

export interface TimelinePage {
  events: ExecutionTimelineEvent[];
  nextCursor: string | null;
}

// Statuses worth continuing to poll for — mirrors
// ACTIVE_SPRINT_EXECUTION_STATUSES on the backend (item 153).
export const ACTIVE_MONITOR_STATUSES = ['QUEUED', 'RUNNING', 'PAUSED', 'BLOCKED'];
