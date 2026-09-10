import { SprintAcceptanceStatus } from '@prisma/client';
import { SprintAcceptanceErrorCode } from '../errors/sprint-acceptance.error';
import { JobRecord } from '../../jobs/types/job.types';
import {
  ChangedFileEvidence,
  CommitSummaryEvidence,
  RequirementCoverageEntry,
  RiskSummaryEvidence,
  ValidationSummaryEvidence,
} from './evidence.types';
import { AcceptanceRecommendation, ReviewFinding } from './review.types';

// Public-facing shape of a SprintAcceptance — never exposes an absolute
// workspace path, raw provider payload, or unbounded logs (item 101).
// `backgroundJobId` IS exposed, mirroring SprintExecutionRecord's own
// deliberate exception (Sprint 14): the review-generation Job id carries no
// sensitive information and is needed for refresh-resilience while
// REVIEWING.
export interface SprintAcceptanceRecord {
  id: string;
  projectId: string;
  sprintId: string;
  sprintPlanId: string;
  sprintExecutionId: string;
  version: number;
  status: SprintAcceptanceStatus;
  deterministicPassed: boolean;
  deterministicSummary: string | null;

  requirementCoverage: RequirementCoverageEntry[] | null;
  validationSummary: ValidationSummaryEvidence | null;
  commitSummary: CommitSummaryEvidence | null;
  riskSummary: RiskSummaryEvidence | null;
  changedFiles: ChangedFileEvidence[] | null;

  repositoryHeadSha: string | null;
  evidenceHash: string | null;
  // True once the live workspace HEAD (or evidence hash) no longer matches
  // what this version was generated against (items 50-53) — a stale
  // version can be viewed but never Accepted/Rejected.
  stale: boolean;

  aiReviewStatus: string | null;
  aiSummary: string | null;
  objectiveAssessment: { satisfied: boolean; rationale: string } | null;
  architectureAssessment: { aligned: boolean; concerns: string[] } | null;
  riskAssessment: { acceptable: boolean; concerns: string[] } | null;
  findings: ReviewFinding[] | null;
  recommendation: AcceptanceRecommendation | null;

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
  reviewedAt: Date | null;
  rejectionReason: string | null;
  reviewerNotes: string | null;

  backgroundJobId: string | null;

  createdAt: Date;
  updatedAt: Date;
}

export interface SprintAcceptanceEligibilityResult {
  eligible: boolean;
  reasons: SprintAcceptanceErrorCode[];
  sprint: { id: string; status: string };
}

export interface GenerateAcceptanceResult {
  sprintAcceptance: SprintAcceptanceRecord;
  job: JobRecord;
}

export interface DecideAcceptanceInput {
  notes?: string;
}

export interface RejectAcceptanceInput {
  reason: string;
}

// The reusable read Sprint 14/17 consume (items 57/112) — never re-derives
// acceptance rules, just answers the one question dependents need.
export interface SprintAcceptanceGateStatus {
  accepted: boolean;
  status: SprintAcceptanceStatus | null;
  version: number | null;
}
