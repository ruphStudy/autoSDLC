export type ApprovalStage = 'ANALYSIS' | 'ARCHITECTURE' | 'SPRINT_PLAN' | 'START_DEVELOPMENT';

export type ApprovalDecision = 'APPROVED' | 'CHANGES_REQUESTED';

export type ApprovalArtifactType = 'PROJECT_ANALYSIS' | 'ARCHITECTURE' | 'SPRINT_PLAN' | 'PROJECT';

export interface ApprovalRecord {
  id: string;
  projectId: string;
  stage: ApprovalStage;
  decision: ApprovalDecision;
  artifactType: ApprovalArtifactType;
  artifactVersion: number | null;
  comment: string | null;
  decidedByUserId: string;
  decidedAt: string;
  createdAt: string;
}

// What one stage's review panel needs: the current artifact version (if
// any) and the latest decision tied to that exact version — never a
// decision left over from an older, now-superseded version.
export interface ApprovalStatus {
  stage: ApprovalStage;
  currentVersion: number | null;
  decision: ApprovalDecision | null;
  comment: string | null;
  decidedAt: string | null;
  decidedByUserId: string | null;
}

export interface ApprovalSummaryEntry {
  decision: ApprovalDecision | null;
  version: number | null;
  decidedAt: string | null;
}

export interface ApprovalSummary {
  analysis: ApprovalSummaryEntry;
  architecture: ApprovalSummaryEntry;
  sprintPlan: ApprovalSummaryEntry;
  startDevelopment: ApprovalSummaryEntry;
}

export interface DecideApprovalPayload {
  decision: ApprovalDecision;
  comment?: string;
}
