import { AnalysisSource } from '@prisma/client';

export interface SprintPlanVersionSummary {
  id: string;
  version: number;
  source: AnalysisSource;
  basedOnVersion: number | null;
  architectureId: string;
  promptVersion: string | null;
  provider: string | null;
  model: string | null;
  createdAt: Date;
}

/** A fully hydrated plan: the SprintPlan row plus its ordered Sprint/Task graph. */
export interface SprintPlanGraph {
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
  createdAt: Date;
  updatedAt: Date;
  sprints: SprintGraph[];
}

export interface SprintGraph {
  id: string;
  number: number;
  title: string;
  objective: string;
  description: string | null;
  status: string;
  order: number;
  dependsOnSprintNumbers: number[];
  tasks: TaskGraph[];
}

export interface TaskGraph {
  id: string;
  key: string;
  title: string;
  description: string;
  status: string;
  order: number;
  acceptanceCriteria: unknown;
  validationExpectations: unknown;
  requirementIds: unknown;
  architectureAreas: unknown;
  dependsOnTaskKeys: string[];
}
