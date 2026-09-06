import { Injectable, Logger } from '@nestjs/common';
import OpenAI from 'openai';
import { zodResponseFormat } from 'openai/helpers/zod';
import { PlanningAIConfigService } from '../planning-ai.config';
import {
  PlanningAIProvider,
  PlanningProviderHealth,
} from '../contracts/planning-provider.interface';
import { PlanningAIRequest } from '../contracts/planning-request';
import { PlanningAIResult } from '../contracts/planning-response';
import {
  PlanningAIError,
  PlanningErrorCode,
} from '../errors/planning-ai.error';
import { mapOpenAIError } from '../errors/provider-error.mapper';
import { withRetry } from '../utils/retry';
import { withTimeout } from '../utils/timeout';
import {
  PlanningHealthPrompt,
  PlanningHealthSchema,
} from '../prompts/planning-health.prompt';
import { PlanningOperation } from '../planning-ai.constants';

const PROVIDER_NAME = 'openai';

interface AttemptOutcome<T> {
  data: T;
  model: string;
  requestId?: string;
  usage: PlanningAIResult<T>['usage'];
}

@Injectable()
export class OpenAIPlanningProvider implements PlanningAIProvider {
  private readonly logger = new Logger(OpenAIPlanningProvider.name);
  private readonly client: OpenAI;

  constructor(private readonly config: PlanningAIConfigService) {
    this.client = new OpenAI({ apiKey: config.openai.apiKey });
  }

  async generateStructuredOutput<T>(
    request: PlanningAIRequest<T>,
  ): Promise<PlanningAIResult<T>> {
    const start = Date.now();
    this.logger.log(
      `Planning AI request started (operation=${request.operation}, model=${this.config.openai.model})`,
    );

    try {
      const { result, attempts } = await withRetry<AttemptOutcome<T>>(
        (attempt) => this.attemptOnce(request, attempt),
        {
          maxRetries: this.config.openai.maxRetries,
          isRetryable: (error) =>
            error instanceof PlanningAIError && error.retryable,
          delayOverrideMs: (error) =>
            error instanceof PlanningAIError ? error.retryAfterMs : undefined,
        },
      );

      const latencyMs = Date.now() - start;
      this.logger.log(
        `Planning AI request succeeded (operation=${request.operation}, attempts=${attempts}, latencyMs=${latencyMs})`,
      );

      return {
        data: result.data,
        usage: result.usage,
        metadata: {
          provider: PROVIDER_NAME,
          model: result.model,
          operation: request.operation,
          latencyMs,
          attempts,
          requestId: result.requestId,
        },
      };
    } catch (rawError) {
      const error = mapOpenAIError(rawError);
      this.logger.warn(
        `Planning AI request failed (operation=${request.operation}, code=${error.code}, retryable=${error.retryable})`,
      );
      throw error;
    }
  }

  private async attemptOnce<T>(
    request: PlanningAIRequest<T>,
    attempt: number,
  ): Promise<AttemptOutcome<T>> {
    if (attempt > 1) {
      this.logger.log(
        `Planning AI retry (operation=${request.operation}, attempt=${attempt})`,
      );
    }

    let completion: OpenAI.Chat.Completions.ChatCompletion;
    try {
      completion = await withTimeout(
        (signal) =>
          this.client.chat.completions.create(
            {
              model: this.config.openai.model,
              temperature:
                request.temperature ?? this.config.openai.temperature,
              max_tokens: request.maxOutputTokens,
              messages: [
                { role: 'system', content: request.systemPrompt },
                { role: 'user', content: request.userPrompt },
              ],
              response_format: zodResponseFormat(
                request.schema,
                request.schemaName,
              ),
            },
            { signal },
          ),
        this.config.openai.timeoutMs,
        request.signal,
      );
    } catch (error) {
      throw mapOpenAIError(error);
    }

    return this.toAttemptOutcome(request, completion);
  }

  private toAttemptOutcome<T>(
    request: PlanningAIRequest<T>,
    completion: OpenAI.Chat.Completions.ChatCompletion,
  ): AttemptOutcome<T> {
    const choice = completion.choices[0];
    const message = choice?.message;

    if (choice?.finish_reason === 'content_filter') {
      throw new PlanningAIError({
        code: PlanningErrorCode.CONTENT_REFUSED,
        message: 'Planning AI provider declined to answer (content filter).',
        provider: PROVIDER_NAME,
        retryable: false,
      });
    }

    if (message?.refusal) {
      throw new PlanningAIError({
        code: PlanningErrorCode.CONTENT_REFUSED,
        message: 'Planning AI provider refused the request.',
        provider: PROVIDER_NAME,
        retryable: false,
      });
    }

    if (choice?.finish_reason === 'length') {
      throw new PlanningAIError({
        code: PlanningErrorCode.CONTEXT_LIMIT,
        message:
          'Planning AI response was truncated before completion (output token limit).',
        provider: PROVIDER_NAME,
        retryable: false,
      });
    }

    const rawContent = message?.content;
    if (!rawContent) {
      throw new PlanningAIError({
        code: PlanningErrorCode.INVALID_STRUCTURED_RESPONSE,
        message: 'Planning AI provider returned no content.',
        provider: PROVIDER_NAME,
        retryable: false,
      });
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(rawContent);
    } catch (jsonError) {
      throw new PlanningAIError({
        code: PlanningErrorCode.INVALID_STRUCTURED_RESPONSE,
        message: 'Planning AI provider response was not valid JSON.',
        provider: PROVIDER_NAME,
        retryable: false,
        cause: jsonError,
      });
    }

    const validation = request.schema.safeParse(parsedJson);
    if (!validation.success) {
      throw new PlanningAIError({
        code: PlanningErrorCode.INVALID_STRUCTURED_RESPONSE,
        message: `Planning AI provider response did not match the "${request.schemaName}" schema.`,
        provider: PROVIDER_NAME,
        retryable: false,
        cause: validation.error,
      });
    }

    return {
      data: validation.data,
      model: completion.model,
      requestId: completion.id,
      usage: {
        inputTokens: completion.usage?.prompt_tokens,
        outputTokens: completion.usage?.completion_tokens,
        totalTokens: completion.usage?.total_tokens,
      },
    };
  }

  async healthCheck(): Promise<PlanningProviderHealth> {
    const configured = Boolean(this.config.openai.apiKey);
    if (!configured) {
      return { provider: PROVIDER_NAME, configured: false };
    }

    const start = Date.now();
    try {
      const prompts = PlanningHealthPrompt.build({});
      const result = await this.generateStructuredOutput({
        operation: PlanningOperation.GENERAL_PLANNING,
        systemPrompt: prompts.systemPrompt,
        userPrompt: prompts.userPrompt,
        schema: PlanningHealthSchema,
        schemaName: 'planning_health',
        maxOutputTokens: 20,
      });

      return {
        provider: PROVIDER_NAME,
        configured: true,
        reachable: true,
        model: result.metadata.model,
        latencyMs: Date.now() - start,
      };
    } catch (error) {
      const planningError = mapOpenAIError(error);
      return {
        provider: PROVIDER_NAME,
        configured: true,
        reachable: false,
        latencyMs: Date.now() - start,
        errorCode: planningError.code,
      };
    }
  }
}
