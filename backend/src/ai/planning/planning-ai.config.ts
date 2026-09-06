import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PlanningAIError, PlanningErrorCode } from './errors/planning-ai.error';

export type SupportedPlanningProvider = 'openai';

export interface OpenAIPlanningConfig {
  apiKey: string;
  model: string;
  timeoutMs: number;
  maxRetries: number;
  temperature: number;
}

/**
 * The single place that reads PLANNING_AI_* / OPENAI_PLANNING_* env vars.
 * Nothing else in the app should touch process.env or ConfigService for
 * these — that keeps provider config centralized and easy to extend when a
 * second provider shows up.
 */
@Injectable()
export class PlanningAIConfigService {
  readonly provider: SupportedPlanningProvider;
  readonly openai: OpenAIPlanningConfig;

  constructor(config: ConfigService) {
    this.provider = config.get<SupportedPlanningProvider>(
      'PLANNING_AI_PROVIDER',
    )!;

    this.openai = {
      apiKey: config.get<string>('OPENAI_API_KEY') ?? '',
      model: config.get<string>('OPENAI_PLANNING_MODEL')!,
      timeoutMs: config.get<number>('OPENAI_PLANNING_TIMEOUT_MS')!,
      maxRetries: config.get<number>('OPENAI_PLANNING_MAX_RETRIES')!,
      temperature: config.get<number>('OPENAI_PLANNING_TEMPERATURE')!,
    };

    // Joi already enforces this at app boot; re-checking here means a
    // service constructed directly (e.g. in a test) fails the same clear
    // way instead of surfacing a confusing "undefined" deep inside a call.
    if (this.provider === 'openai' && !this.openai.apiKey) {
      throw new PlanningAIError({
        code: PlanningErrorCode.CONFIGURATION_ERROR,
        message: 'OPENAI_API_KEY is required when PLANNING_AI_PROVIDER=openai.',
        provider: 'openai',
        retryable: false,
      });
    }
  }
}
