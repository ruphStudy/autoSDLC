export type FindingSeverity = 'INFO' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export type FindingCategory =
  | 'REQUIREMENT'
  | 'ARCHITECTURE'
  | 'VALIDATION'
  | 'SECURITY'
  | 'QUALITY'
  | 'TESTING'
  | 'RISK'
  | 'DOCUMENTATION'
  | 'OTHER';

export interface ReviewFinding {
  id: string;
  severity: FindingSeverity;
  category: FindingCategory;
  title: string;
  description: string;
  evidence: string[];
  relatedTaskKeys: string[];
  relatedRequirementIds: string[];
  relatedAdrIds: string[];
  blocking: boolean;
}

export type AcceptanceRecommendation =
  'ACCEPT' | 'ACCEPT_WITH_NOTES' | 'NEEDS_ATTENTION' | 'REJECT';

// The exact structured shape PlanningAIProvider must return (items 30/86) —
// application-validated afterward (items 31/85), never trusted as-is.
export interface SprintAcceptanceReviewContent {
  summary: string;
  objectiveAssessment: { satisfied: boolean; rationale: string };
  requirementAssessment: { satisfied: boolean; gaps: string[] };
  architectureAssessment: { aligned: boolean; concerns: string[] };
  validationAssessment: { sufficient: boolean; concerns: string[] };
  riskAssessment: { acceptable: boolean; concerns: string[] };
  findings: ReviewFinding[];
  recommendation: AcceptanceRecommendation;
}
