import {
  AgentJobStatus,
  ProjectStatus,
  SprintExecutionStatus,
  SprintStatus,
  TaskExecutionStatus,
  TaskStatus,
  ValidationAttemptStatus,
  ValidationCheckType,
  ValidationRunStatus,
  WorkspaceStatus,
} from '@prisma/client';

// Deterministic, derived-only "what is happening right now" phase (items
// 5/6/56) — never persisted, never AI-derived. Resolved purely from
// SprintExecution/Task/TaskExecution/AgentJob/ValidationAttempt state by
// resolveExecutionPhase (see phase-resolver.ts).
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
export type EventScope =
  'PROJECT' | 'SPRINT' | 'TASK' | 'AGENT' | 'VALIDATION' | 'GIT';

// Never exposes an absolute filesystem path (item 27/96) — only a live,
// bounded Git read of the already-prepared workspace.
export interface WorkspaceSummary {
  status: WorkspaceStatus;
  branch: string | null;
  clean: boolean | null;
  headCommitSha: string | null;
}

export interface TaskPipelineEntry {
  id: string;
  key: string;
  title: string;
  status: TaskStatus;
  commitSha: string | null;
}

export interface SprintProgressSummary {
  sprintId: string;
  number: number;
  title: string;
  objective: string;
  status: SprintStatus;
  totalTasks: number;
  passedTasks: number;
  runningTasks: number;
  reviewingTasks: number;
  failedTasks: number;
  blockedTasks: number;
  remainingTasks: number;
  progressPercent: number;
}

// The Sprint currently (or most recently) being executed — "isLive" tells
// the frontend whether this is genuinely in-flight (poll it) or a
// historical snapshot shown only because nothing is running right now.
export interface ActiveSprintExecutionSummary {
  id: string;
  sprintId: string;
  sprintNumber: number;
  sprintTitle: string;
  sprintObjective: string;
  attempt: number;
  status: SprintExecutionStatus;
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
  // Exposed for the same reason as SprintExecutionRecord itself (Sprint
  // 14): the dashboard's Cancel control needs it to call the existing
  // Job-cancel endpoint, and a Job id carries no sensitive information on
  // its own (Job endpoints are already ownership-gated).
  backgroundJobId: string | null;
}

export interface CurrentTaskSummary {
  id: string;
  key: string;
  title: string;
  status: TaskStatus;
  executionAttempt: number | null;
  executionStatus: TaskExecutionStatus | null;
  instructionVersion: number | null;
  changedFileCount: number;
  startedAt: string | null;
  durationMs: number | null;
}

// Bounded, safe technical view of the coding agent's most recent activity
// for the current Task (item 15/20/21) — never a raw provider transcript.
export interface AgentActivitySummary {
  id: string;
  provider: string;
  model: string | null;
  status: AgentJobStatus;
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

// One row's worth of a ValidationRun — deliberately excludes stdout/stderr
// (item 79/80) — fetch the full ValidationAttempt detail endpoint to expand.
export interface ValidationCheckSummary {
  type: ValidationCheckType;
  name: string;
  required: boolean;
  status: ValidationRunStatus;
  durationMs: number | null;
  exitCode: number | null;
}

export interface ValidationActivitySummary {
  id: string;
  attempt: number;
  status: ValidationAttemptStatus;
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

// Coding-agent and Planning-AI usage are kept structurally separate (item
// 17) — different providers, different purpose. No money/cost anywhere
// (item 16/74/98) — Sprint 22 owns that.
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

// Metadata is bounded/safe by construction (item 10/77/78) — every field
// populated here already came from a redacted/bounded source (ValidationRun
// stdout/stderr are never included; AgentJob.instruction is never included).
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
  projectStatus: ProjectStatus;
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
  status: SprintExecutionStatus;
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
