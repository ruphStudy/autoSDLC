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

export interface ProjectDeliveryRecord {
  id: string;
  projectId: string;
  version: number;
  repositoryFinalSha: string;
  repositoryBranch: string | null;
  requiredSprints: RequiredSprintEvidence[];
  requirementCoverage: RequirementDeliveryCoverageEntry[];
  taskSummary: TaskDeliverySummary;
  validationSummary: ValidationDeliverySummary;
  commitSummary: CommitDeliverySummary;
  usageSummary: UsageDeliverySummary;
  warnings: string[];
  deliverySummary: string;
  deliveryEvidenceHash: string;
  finalizedByUserId: string;
  finalizedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectCompletionEligibility {
  eligible: boolean;
  reasons: string[];
  project: { id: string; status: string };
}

export interface CompleteProjectResult {
  project: { id: string; status: string; completedAt: string | null };
  delivery: ProjectDeliveryRecord;
  alreadyCompleted: boolean;
}

// Human-readable copy for each eligibility reason code — mirrors the
// backend's ProjectDeliveryErrorCode enum exactly, so a new backend reason
// added later fails loudly (falls through to the raw code) rather than
// silently showing nothing.
export const COMPLETION_REASON_LABELS: Record<string, string> = {
  PROJECT_ARCHIVED: 'This project is archived. Restore it first.',
  NO_SPRINT_PLAN: 'No Sprint Plan has been generated yet.',
  DEVELOPMENT_NOT_APPROVED: 'Development has not been approved yet.',
  PROJECT_ALREADY_COMPLETED: 'This project has already been completed.',
  SPRINT_NOT_PASSED: 'Not every Sprint has passed yet.',
  SPRINT_NOT_ACCEPTED: 'Not every passed Sprint has been formally accepted.',
  TASK_NOT_PASSED: 'Not every Task has passed yet.',
  REQUIREMENT_NOT_COVERED:
    'Not every functional requirement is covered by a delivered Task.',
  ACTIVE_SPRINT_EXECUTION: 'A Sprint execution is still in progress.',
  WORKSPACE_NOT_READY: 'The project workspace could not be read.',
  WORKSPACE_DIRTY: 'The workspace has uncommitted changes.',
  FINAL_SHA_MISMATCH:
    'The repository has changed since the last Sprint finished.',
  PROJECT_DELIVERY_STATE_CHANGED:
    'Project state changed since eligibility was last checked. Try again.',
};
