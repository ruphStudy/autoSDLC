// Public-facing shape of a TaskInstruction — owner-scoped only. Excludes
// nothing structural (this is a technical/audit artifact, not end-user
// content), but never includes an absolute filesystem path, and
// `contextSnapshot` itself is already bounded metadata, never raw file
// contents (see TaskInstructionService.buildContextSnapshot).
export interface TaskInstructionRecord {
  id: string;
  projectId: string;
  taskId: string;
  version: number;

  sprintPlanId: string;
  architectureId: string;
  projectAnalysisId: string;

  objective: string;
  repositoryObservations: string[];
  implementationPlan: unknown[];
  constraints: string[];
  acceptanceCriteria: string[];
  validationPlan: unknown[];
  dependencyContext: unknown[];
  risksOrWatchouts: string[];
  finalInstruction: string;

  contextSnapshot: unknown;

  repositoryHeadSha: string;
  repositoryBranch: string | null;

  promptName: string;
  promptVersion: string;
  provider: string;
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  latencyMs: number;
  attempts: number;
  providerRequestId: string | null;

  createdAt: Date;

  // Computed at read time (never stored) — true when repositoryHeadSha no
  // longer matches the workspace's live HEAD (item 55).
  stale: boolean;
}

export interface ContextSnapshot {
  projectAnalysisVersion: number;
  architectureVersion: number;
  sprintPlanVersion: number;
  sprintNumber: number;
  taskKey: string;
  dependencyTaskKeys: string[];
  repositoryHeadSha: string;
  repositoryBranch: string | null;
  relevantFiles: string[];
  repositoryTreeEntryCount: number;
  repositoryTreeTruncated: boolean;
  manifestsSkipped: string[];
}
