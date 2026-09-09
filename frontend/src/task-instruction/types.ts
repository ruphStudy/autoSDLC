export interface ImplementationStep {
  step: number;
  description: string;
  likelyFiles?: string[];
}

export interface ValidationPlanItem {
  type: string;
  description: string;
  required: boolean;
}

export interface DependencyContextItem {
  taskKey: string;
  summary: string;
}

// Mirrors the backend's TaskInstructionRecord — owner-scoped, technical
// preview only (no manual editing — see item 57).
export interface TaskInstruction {
  id: string;
  projectId: string;
  taskId: string;
  version: number;

  sprintPlanId: string;
  architectureId: string;
  projectAnalysisId: string;

  objective: string;
  repositoryObservations: string[];
  implementationPlan: ImplementationStep[];
  constraints: string[];
  acceptanceCriteria: string[];
  validationPlan: ValidationPlanItem[];
  dependencyContext: DependencyContextItem[];
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

  createdAt: string;
  stale: boolean;
}
