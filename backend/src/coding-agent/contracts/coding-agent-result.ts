export type CodingAgentChangeType =
  'ADDED' | 'MODIFIED' | 'DELETED' | 'RENAMED' | 'UNKNOWN';

// Repository-relative only — never an absolute filesystem path (see
// changed-file detection in the Claude provider, which derives this from
// GitService's before/after status rather than trusting the provider's own
// narrative).
export interface CodingAgentChangedFile {
  path: string;
  changeType: CodingAgentChangeType;
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

export interface CodingAgentUsage {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
}

export interface CodingAgentExecutionResult {
  status: 'SUCCEEDED' | 'FAILED' | 'CANCELLED';

  summary: string;

  // Populated whenever status !== 'SUCCEEDED' — a normalized
  // CodingAgentErrorCode plus a safe message. Kept on the *result* (not
  // thrown) whenever the session actually ran, however briefly, so
  // whatever it changed before failing/timing out/being cancelled is still
  // captured in changedFiles/toolActivities below — see
  // CodingAgentProvider.executeTask's contract note on this.
  errorCode?: string;
  errorMessage?: string;

  changedFiles: CodingAgentChangedFile[];
  toolActivities: CodingAgentToolActivity[];
  commandActivities: CodingAgentCommandActivity[];

  usage?: CodingAgentUsage;

  metadata: {
    provider: string;
    model?: string;
    durationMs: number;
    turns?: number;
    providerRequestId?: string;
  };
}

export interface CodingAgentHealth {
  provider: string;
  configured: boolean;
  reachable?: boolean;
  model?: string;
  errorCode?: string;
}
