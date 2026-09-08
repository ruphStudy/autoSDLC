import {
  ApprovalArtifactType,
  ApprovalDecision,
  ApprovalStage,
} from '@prisma/client';

export interface ApprovalRecord {
  id: string;
  projectId: string;
  stage: ApprovalStage;
  decision: ApprovalDecision;
  artifactType: ApprovalArtifactType;
  artifactVersion: number | null;
  comment: string | null;
  decidedByUserId: string;
  decidedAt: Date;
  createdAt: Date;
}

// What the UI needs to render one stage's review panel: the current
// artifact version (if any) and the latest decision made specifically
// against that exact version — never a decision left over from an older,
// now-superseded version.
export interface ApprovalStatus {
  stage: ApprovalStage;
  currentVersion: number | null;
  decision: ApprovalDecision | null;
  comment: string | null;
  decidedAt: Date | null;
  decidedByUserId: string | null;
}

export interface ApprovalSummaryEntry {
  decision: ApprovalDecision | null;
  version: number | null;
  decidedAt: Date | null;
}

export interface ApprovalSummary {
  analysis: ApprovalSummaryEntry;
  architecture: ApprovalSummaryEntry;
  sprintPlan: ApprovalSummaryEntry;
  startDevelopment: ApprovalSummaryEntry;
}
