// Bounded, structured evidence assembled by SprintAcceptanceEvidenceBuilder
// (items 10-23) — never raw stdout/logs/full diffs/full source. This is
// both (a) what gets persisted (as the individually-typed JSON columns on
// SprintAcceptance) and (b) the canonical object SHA-256-hashed into
// `evidenceHash`, and (c) the source the AI prompt is built from (items
// 11/83/123 — a bounded subset of this, never the raw repository).

export interface TaskEvidence {
  key: string;
  title: string;
  description: string;
  status: string;
  acceptanceCriteria: string[];
  requirementIds: string[];
  architectureAreas: string[];
  executionAttempt: number | null;
  commitSha: string | null;
  changedFileCount: number;
  validationStatus: string | null;
  validationRequiredPassed: number;
  validationRequiredFailed: number;
}

export interface RequirementCoverageEntry {
  requirementId: string;
  title: string;
  taskKeys: string[];
  tasksPassed: boolean;
  validationPassed: boolean;
  commitShas: string[];
}

export interface ValidationSummaryEvidence {
  totalRuns: number;
  requiredRuns: number;
  requiredPassed: number;
  optionalPassed: number;
  optionalFailed: number;
  failedRequiredChecks: string[];
}

export interface CommitEvidenceEntry {
  taskKey: string;
  commitSha: string;
  changedFileCount: number;
}

export interface CommitSummaryEvidence {
  startSha: string | null;
  endSha: string | null;
  commits: CommitEvidenceEntry[];
  // True only if every Task that reached PASSED has exactly one recorded
  // commit and the Sprint's final SHA is reachable from the chain of
  // per-Task commits (item 20/21) — never re-derived from a live `git log`
  // walk; TaskExecution's own stored commitSha values are authoritative
  // (item 80).
  chainComplete: boolean;
}

export interface RelevantAdrEvidence {
  id: string;
  title: string;
  decision: string;
}

export interface ArchitectureContextEvidence {
  relevantAreas: string[];
  relevantAdrs: RelevantAdrEvidence[];
  allAdrIds: string[];
}

export interface RiskSummaryEvidence {
  projectRisks: { risk: string; severity: string; mitigation: string | null }[];
  unresolvedArchitectureQuestions: { question: string; impact: string }[];
  optionalValidationFailures: string[];
}

export interface ChangedFileEvidence {
  path: string;
  taskCount: number;
}

export interface SprintAcceptanceEvidence {
  sprint: {
    id: string;
    number: number;
    title: string;
    objective: string;
    status: string;
  };
  sprintPlan: { id: string; version: number };
  architecture: { id: string; version: number };
  projectAnalysis: { id: string; version: number };
  sprintExecution: {
    id: string;
    attempt: number;
    status: string;
    startedAt: string | null;
    completedAt: string | null;
    repositoryStartSha: string | null;
    repositoryEndSha: string | null;
    totalTasks: number;
    passedTasks: number;
  };
  tasks: TaskEvidence[];
  requirementCoverage: RequirementCoverageEntry[];
  architectureContext: ArchitectureContextEvidence;
  validationSummary: ValidationSummaryEvidence;
  commitSummary: CommitSummaryEvidence;
  riskSummary: RiskSummaryEvidence;
  changedFiles: ChangedFileEvidence[];
  workspace: {
    clean: boolean | null;
    headCommitSha: string | null;
    branch: string | null;
  };
}
