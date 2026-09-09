import { AgentJobStatus } from '@prisma/client';
import {
  CodingAgentChangedFile,
  CodingAgentCommandActivity,
  CodingAgentToolActivity,
} from '../contracts/coding-agent-result';

// Public-facing shape of an AgentJob — owner-scoped only (see
// CodingAgentService), excludes nothing else: the Sprint 10 instruction is
// always a fixed, backend-generated diagnostic string, never user-supplied,
// so there is nothing sensitive in showing it back to the project's owner.
export interface AgentJobRecord {
  id: string;
  projectId: string;
  taskId: string | null;
  provider: string;
  model: string | null;
  status: AgentJobStatus;
  instruction: string;
  attemptCount: number;
  maxAttempts: number;
  startedAt: Date | null;
  completedAt: Date | null;
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
  createdAt: Date;
  updatedAt: Date;
}
