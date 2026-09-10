import { ProjectDeliveryErrorCode } from '../errors/project-delivery.error';
import {
  CommitDeliverySummary,
  RequirementDeliveryCoverageEntry,
  RequiredSprintEvidence,
  TaskDeliverySummary,
  UsageDeliverySummary,
  ValidationDeliverySummary,
} from './evidence.types';

// Public-facing shape of a ProjectDelivery — never exposes an absolute
// workspace path or raw provider payload (there is none: this domain never
// calls a provider), same discipline as every other *Record type in this
// codebase.
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
  finalizedAt: Date;

  createdAt: Date;
  updatedAt: Date;
}

export interface ProjectCompletionEligibilityResult {
  eligible: boolean;
  reasons: ProjectDeliveryErrorCode[];
  project: { id: string; status: string };
}

export interface CompleteProjectResult {
  project: { id: string; status: string; completedAt: string | null };
  delivery: ProjectDeliveryRecord;
  // True when this call returned an already-existing delivery rather than
  // finalizing a new one (item 45's idempotent-return path) — lets the
  // client distinguish "you just completed this" from "this was already
  // done" without inspecting timestamps.
  alreadyCompleted: boolean;
}
