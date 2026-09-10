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
  chainComplete: boolean;
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

export type FindingSeverity = 'INFO' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface ReviewFinding {
  id: string;
  severity: FindingSeverity;
  category: string;
  title: string;
  description: string;
  evidence: string[];
  relatedTaskKeys: string[];
  relatedRequirementIds: string[];
  relatedAdrIds: string[];
  blocking: boolean;
}

export interface SprintAcceptanceRecord {
  id: string;
  projectId: string;
  sprintId: string;
  sprintPlanId: string;
  sprintExecutionId: string;
  version: number;
  status: string;
  deterministicPassed: boolean;
  deterministicSummary: string | null;
  requirementCoverage: RequirementCoverageEntry[] | null;
  validationSummary: ValidationSummaryEvidence | null;
  commitSummary: CommitSummaryEvidence | null;
  riskSummary: RiskSummaryEvidence | null;
  changedFiles: ChangedFileEvidence[] | null;
  repositoryHeadSha: string | null;
  evidenceHash: string | null;
  stale: boolean;
  aiReviewStatus: string | null;
  aiSummary: string | null;
  objectiveAssessment: { satisfied: boolean; rationale: string } | null;
  architectureAssessment: { aligned: boolean; concerns: string[] } | null;
  riskAssessment: { acceptable: boolean; concerns: string[] } | null;
  findings: ReviewFinding[] | null;
  recommendation: string | null;
  promptName: string | null;
  promptVersion: string | null;
  provider: string | null;
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  latencyMs: number | null;
  attempts: number | null;
  providerRequestId: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  reviewedByUserId: string | null;
  reviewedAt: string | null;
  rejectionReason: string | null;
  reviewerNotes: string | null;
  backgroundJobId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SprintAcceptanceEligibility {
  eligible: boolean;
  reasons: string[];
  sprint: { id: string; status: string };
}

// Statuses where the review generation job is still doing work.
export const ACTIVE_ACCEPTANCE_STATUSES = ['PENDING', 'REVIEWING'];
