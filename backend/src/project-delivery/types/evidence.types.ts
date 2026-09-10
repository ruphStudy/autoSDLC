// Bounded, structured evidence assembled by ProjectDeliveryEvidenceBuilder —
// never raw stdout/logs/full diffs/full source, same discipline as
// SprintAcceptance's own evidence shape. This is both (a) what gets
// persisted (as the individually-typed JSON columns on ProjectDelivery) and
// (b) the canonical object SHA-256-hashed into `deliveryEvidenceHash`. Zero
// AI content anywhere in this shape — Sprint 17 never calls a provider.

export interface RequiredSprintEvidence {
  sprintId: string;
  number: number;
  title: string;
  status: string;
  sprintExecutionId: string | null;
  sprintExecutionAttempt: number | null;
  repositoryEndSha: string | null;
  completedAt: string | null;
  acceptanceVersion: number | null;
  acceptanceStatus: string | null;
}

export interface RequirementDeliveryCoverageEntry {
  requirementId: string;
  title: string;
  covered: boolean;
  taskKeys: string[];
}

export interface TaskDeliverySummary {
  totalTasks: number;
  passedTasks: number;
  nonPassedTaskKeys: string[];
}

export interface ValidationDeliverySummary {
  totalChecks: number;
  requiredPassed: number;
  requiredFailed: number;
  optionalPassed: number;
  optionalFailed: number;
}

export interface CommitDeliverySummary {
  totalCommits: number;
  firstCommitSha: string | null;
  lastCommitSha: string | null;
}

export interface UsageByCategory {
  category: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface UsageDeliverySummary {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  byCategory: UsageByCategory[];
}

export interface ProjectDeliveryEvidence {
  project: { id: string; name: string };
  sprintPlan: { id: string; version: number };
  projectAnalysis: { id: string; version: number };
  requiredSprints: RequiredSprintEvidence[];
  requirementCoverage: RequirementDeliveryCoverageEntry[];
  taskSummary: TaskDeliverySummary;
  validationSummary: ValidationDeliverySummary;
  commitSummary: CommitDeliverySummary;
  usageSummary: UsageDeliverySummary;
  warnings: string[];
  workspace: {
    clean: boolean | null;
    headCommitSha: string | null;
    branch: string | null;
  };
  // The authoritative final SHA (items 21/22): the repositoryEndSha of the
  // required Sprint's SprintExecution with the latest completedAt among all
  // COMPLETED executions for required Sprints — never a naive "last Sprint
  // in array order" read.
  resolvedFinalSha: string | null;
}
