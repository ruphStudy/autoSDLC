import type { PlanningOperation } from '../planning-ai.constants';

export interface PlanningUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export interface PlanningMetadata {
  provider: string;
  model: string;
  operation: PlanningOperation;
  latencyMs: number;
  attempts: number;
  requestId?: string;
}

export interface PlanningAIResult<T> {
  data: T;
  usage: PlanningUsage;
  metadata: PlanningMetadata;
}
