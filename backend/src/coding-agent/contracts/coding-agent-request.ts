// Provider-neutral execution request. `workspacePath` must only ever be
// populated by trusted internal orchestration code (CodingAgentService,
// resolved via WorkspaceService) — never accepted from an HTTP client. See
// coding-agent.controller.ts, which never exposes a workingDirectory field.
export interface CodingAgentExecutionRequest {
  projectId: string;
  taskId?: string;
  instruction: string;
  workspacePath: string;

  constraints?: {
    maxTurns?: number;
    timeoutMs?: number;
  };

  context?: {
    projectSummary?: string;
    architectureSummary?: string;
    acceptanceCriteria?: string[];
    validationExpectations?: unknown[];
  };

  signal?: AbortSignal;
}
