import type { ZodType } from 'zod';
import type { PlanningOperation } from '../planning-ai.constants';

/** Alias so call sites talk about "a schema for T" without importing zod directly. */
export type RuntimeSchema<T> = ZodType<T>;

export interface PlanningAIRequest<T> {
  operation: PlanningOperation;

  /** Authoritative application instructions — never overridden by user content. */
  systemPrompt: string;

  /** User/project content. Treated as data, not instructions. */
  userPrompt: string;

  /** Validated against the provider's response on the application side. */
  schema: RuntimeSchema<T>;

  /** Short machine name for the schema (used as the structured-output name). */
  schemaName: string;

  temperature?: number;

  maxOutputTokens?: number;

  /** Free-form tags for logging/observability, e.g. { projectId }. Never secrets. */
  metadata?: Record<string, string>;

  /** Lets a future caller (orchestration, request cancellation) abort the call. */
  signal?: AbortSignal;
}
