import type { PlanningAIRequest } from './planning-request';
import type { PlanningAIResult } from './planning-response';

export interface PlanningProviderHealth {
  provider: string;
  configured: boolean;
  reachable?: boolean;
  model?: string;
  latencyMs?: number;
  errorCode?: string;
}

/**
 * The one contract business/domain services depend on. No method here
 * exposes an OpenAI (or any other vendor) SDK type — implementations adapt
 * their vendor's request/response shape to this on both sides.
 */
export interface PlanningAIProvider {
  generateStructuredOutput<T>(
    request: PlanningAIRequest<T>,
  ): Promise<PlanningAIResult<T>>;

  /** Cheap, non-authenticated-user-facing connectivity/config check. */
  healthCheck(): Promise<PlanningProviderHealth>;
}
