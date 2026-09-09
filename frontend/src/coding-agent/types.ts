export type AgentJobStatus = 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';

export interface CodingAgentChangedFile {
  path: string;
  changeType: 'ADDED' | 'MODIFIED' | 'DELETED' | 'RENAMED' | 'UNKNOWN';
}

export interface CodingAgentToolActivity {
  type: string;
  name: string;
  startedAt?: string;
  completedAt?: string;
  success?: boolean;
  summary?: string;
}

export interface CodingAgentCommandActivity {
  command: string;
  exitCode?: number;
  durationMs?: number;
  success?: boolean;
  outputTruncated?: boolean;
}

// Mirrors the backend's AgentJobRecord — owner-scoped only.
export interface AgentJob {
  id: string;
  projectId: string;
  taskId: string | null;
  provider: string;
  model: string | null;
  status: AgentJobStatus;
  instruction: string;
  attemptCount: number;
  maxAttempts: number;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  summary: string | null;
  changedFiles: CodingAgentChangedFile[] | null;
  toolActivities: CodingAgentToolActivity[] | null;
  commandActivities: CodingAgentCommandActivity[] | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadInputTokens: number | null;
  cacheCreationInputTokens: number | null;
  turns: number | null;
  providerRequestId: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CodingAgentHealth {
  provider: string;
  configured: boolean;
  reachable?: boolean;
  model?: string;
  errorCode?: string;
}

export const ACTIVE_AGENT_JOB_STATUSES: AgentJobStatus[] = ['QUEUED', 'RUNNING'];
