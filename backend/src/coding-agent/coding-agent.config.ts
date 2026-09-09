import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CodingAgentError,
  CodingAgentErrorCode,
} from './errors/coding-agent.error';

export type SupportedCodingAgentProvider = 'claude';

export interface ClaudeCodingAgentConfig {
  apiKey?: string;
  oauthToken?: string;
  model: string;
  maxTurns: number;
  executionTimeoutMs: number;
  maxOutputBytes: number;
}

// The single place that reads CODING_AGENT_PROVIDER / CLAUDE_* env vars.
// Mirrors PlanningAIConfigService's role for the planning-AI domain.
@Injectable()
export class CodingAgentConfigService {
  readonly provider: SupportedCodingAgentProvider;
  readonly claude: ClaudeCodingAgentConfig;

  constructor(config: ConfigService) {
    this.provider = config.get<SupportedCodingAgentProvider>(
      'CODING_AGENT_PROVIDER',
    )!;

    this.claude = {
      apiKey: config.get<string>('CLAUDE_API_KEY') || undefined,
      oauthToken: config.get<string>('CLAUDE_CODE_OAUTH_TOKEN') || undefined,
      model: config.get<string>('CLAUDE_MODEL')!,
      maxTurns: config.get<number>('CLAUDE_MAX_TURNS')!,
      executionTimeoutMs: config.get<number>('CLAUDE_EXECUTION_TIMEOUT_MS')!,
      maxOutputBytes: config.get<number>('CLAUDE_MAX_OUTPUT_BYTES')!,
    };

    // Joi enforces the provider is a known value at app boot; the auth
    // check can't be expressed cleanly as a Joi .when() (it's "at least one
    // of two keys"), so it lives here — re-checked the same way
    // PlanningAIConfigService re-checks OPENAI_API_KEY, so a service built
    // directly (e.g. in a test) fails the same clear way.
    if (
      this.provider === 'claude' &&
      !this.claude.apiKey &&
      !this.claude.oauthToken
    ) {
      throw new CodingAgentError({
        code: CodingAgentErrorCode.CONFIGURATION_ERROR,
        message:
          'Either CLAUDE_API_KEY or CLAUDE_CODE_OAUTH_TOKEN is required when CODING_AGENT_PROVIDER=claude.',
      });
    }
  }
}
