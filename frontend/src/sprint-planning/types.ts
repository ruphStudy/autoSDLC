import type { AnalysisSource } from '../project-analysis/types';

export type { AnalysisSource };

export type SprintStatus = 'PENDING' | 'RUNNING' | 'TESTING' | 'PASSED' | 'FAILED' | 'BLOCKED';

export type TaskStatus =
  | 'PENDING'
  | 'READY'
  | 'RUNNING'
  | 'REVIEWING'
  | 'PASSED'
  | 'FAILED'
  | 'BLOCKED';

export type ValidationExpectationType =
  | 'lint'
  | 'typecheck'
  | 'unit_test'
  | 'integration_test'
  | 'e2e_test'
  | 'build'
  | 'manual'
  | 'other';

export interface ValidationExpectation {
  type: ValidationExpectationType;
  description: string;
  required: boolean;
}

export interface Task {
  id: string;
  key: string;
  title: string;
  description: string;
  status: TaskStatus;
  order: number;
  acceptanceCriteria: string[];
  validationExpectations: ValidationExpectation[];
  requirementIds: string[];
  architectureAreas: string[];
  dependsOnTaskKeys: string[];
}

export interface Sprint {
  id: string;
  number: number;
  title: string;
  objective: string;
  description: string | null;
  status: SprintStatus;
  order: number;
  dependsOnSprintNumbers: number[];
  tasks: Task[];
}

export interface SprintPlan {
  id: string;
  projectId: string;
  architectureId: string;
  version: number;
  source: AnalysisSource;
  basedOnVersion: number | null;
  summary: string;
  strategy: string;
  estimatedSprintCount: number | null;
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
  sprints: Sprint[];
}

export interface SprintPlanVersionSummary {
  id: string;
  version: number;
  source: AnalysisSource;
  basedOnVersion: number | null;
  architectureId: string;
  promptVersion: string | null;
  provider: string | null;
  model: string | null;
  createdAt: string;
}

// Editable shapes — a SprintPlan edit is a full structured replacement (not
// a partial patch), so these mirror the AI-generated content shape exactly,
// using natural-key dependency references (sprint number / task key) rather
// than raw database ids, matching EditSprintPlanDto + SprintPlanContentSchema
// on the backend.
export interface TaskEditPayload {
  key: string;
  title: string;
  description: string;
  dependencies: string[];
  acceptanceCriteria: string[];
  validationExpectations: ValidationExpectation[];
  requirementIds: string[];
  architectureAreas: string[];
}

export interface SprintEditPayload {
  number: number;
  title: string;
  objective: string;
  description?: string;
  dependencies: number[];
  tasks: TaskEditPayload[];
}

export interface SprintPlanEditPayload {
  summary: string;
  strategy: string;
  sprints: SprintEditPayload[];
}
