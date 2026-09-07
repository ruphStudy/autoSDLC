export type MoscowPriority = 'must_have' | 'should_have' | 'could_have';
export type ImportanceLevel = 'high' | 'medium' | 'low';
export type AnalysisSource = 'AI_GENERATED' | 'USER_EDITED';

export interface TargetUser {
  name: string;
  description: string;
  needs: string[];
}

export interface Goal {
  title: string;
  description: string;
  priority?: ImportanceLevel;
}

export interface Feature {
  name: string;
  description: string;
  priority: MoscowPriority;
}

export interface FunctionalRequirement {
  id: string;
  title: string;
  description: string;
  priority: MoscowPriority;
}

export interface NonFunctionalRequirement {
  category: string;
  requirement: string;
  priority?: ImportanceLevel;
}

export interface Assumption {
  assumption: string;
  impact?: string;
}

export interface Risk {
  risk: string;
  severity: ImportanceLevel;
  mitigation?: string;
}

export interface UnresolvedQuestion {
  question: string;
  importance: ImportanceLevel;
  reason?: string;
}

export interface Integration {
  name: string;
  purpose: string;
  required: boolean;
  notes?: string;
}

export interface ProjectAnalysis {
  id: string;
  projectId: string;
  version: number;
  source: AnalysisSource;
  basedOnVersion: number | null;
  summary: string;
  targetUsers: TargetUser[];
  goals: Goal[];
  features: Feature[];
  functionalRequirements: FunctionalRequirement[];
  nonFunctionalRequirements: NonFunctionalRequirement[];
  assumptions: Assumption[];
  risks: Risk[];
  unresolvedQuestions: UnresolvedQuestion[];
  integrations: Integration[];
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
  createdAt: string;
  updatedAt: string;
}

export interface AnalysisVersionSummary {
  id: string;
  version: number;
  source: AnalysisSource;
  basedOnVersion: number | null;
  promptVersion: string | null;
  provider: string | null;
  model: string | null;
  createdAt: string;
}

// Only the business-content fields a user may edit — never provider/model/
// tokens/version/projectId. Matches EditProjectAnalysisDto on the backend.
export interface ProjectAnalysisEditPayload {
  summary?: string;
  targetUsers?: TargetUser[];
  goals?: Goal[];
  features?: Feature[];
  functionalRequirements?: FunctionalRequirement[];
  nonFunctionalRequirements?: NonFunctionalRequirement[];
  assumptions?: Assumption[];
  risks?: Risk[];
  unresolvedQuestions?: UnresolvedQuestion[];
  integrations?: Integration[];
}
