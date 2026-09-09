import { ConfigService } from '@nestjs/config';
import { CodingAgentConfigService } from './coding-agent.config';
import {
  CodingAgentError,
  CodingAgentErrorCode,
} from './errors/coding-agent.error';

function buildConfigService(values: Record<string, unknown>): ConfigService {
  return {
    get: (key: string) => values[key],
  } as unknown as ConfigService;
}

describe('CodingAgentConfigService', () => {
  it('constructs successfully with CLAUDE_API_KEY configured', () => {
    const service = new CodingAgentConfigService(
      buildConfigService({
        CODING_AGENT_PROVIDER: 'claude',
        CLAUDE_API_KEY: 'sk-ant-test',
        CLAUDE_MODEL: 'claude-sonnet-5',
        CLAUDE_MAX_TURNS: 25,
        CLAUDE_EXECUTION_TIMEOUT_MS: 900000,
        CLAUDE_MAX_OUTPUT_BYTES: 1048576,
      }),
    );
    expect(service.claude.apiKey).toBe('sk-ant-test');
    expect(service.claude.oauthToken).toBeUndefined();
  });

  it('constructs successfully with CLAUDE_CODE_OAUTH_TOKEN configured instead', () => {
    const service = new CodingAgentConfigService(
      buildConfigService({
        CODING_AGENT_PROVIDER: 'claude',
        CLAUDE_CODE_OAUTH_TOKEN: 'oauth-token',
        CLAUDE_MODEL: 'claude-sonnet-5',
        CLAUDE_MAX_TURNS: 25,
        CLAUDE_EXECUTION_TIMEOUT_MS: 900000,
        CLAUDE_MAX_OUTPUT_BYTES: 1048576,
      }),
    );
    expect(service.claude.oauthToken).toBe('oauth-token');
    expect(service.claude.apiKey).toBeUndefined();
  });

  it('throws a clear CONFIGURATION_ERROR when neither credential is set', () => {
    expect(
      () =>
        new CodingAgentConfigService(
          buildConfigService({
            CODING_AGENT_PROVIDER: 'claude',
            CLAUDE_MODEL: 'claude-sonnet-5',
            CLAUDE_MAX_TURNS: 25,
            CLAUDE_EXECUTION_TIMEOUT_MS: 900000,
            CLAUDE_MAX_OUTPUT_BYTES: 1048576,
          }),
        ),
    ).toThrow(CodingAgentError);

    try {
      new CodingAgentConfigService(
        buildConfigService({
          CODING_AGENT_PROVIDER: 'claude',
          CLAUDE_MODEL: 'claude-sonnet-5',
          CLAUDE_MAX_TURNS: 25,
          CLAUDE_EXECUTION_TIMEOUT_MS: 900000,
          CLAUDE_MAX_OUTPUT_BYTES: 1048576,
        }),
      );
      fail('expected a throw');
    } catch (error) {
      expect((error as CodingAgentError).code).toBe(
        CodingAgentErrorCode.CONFIGURATION_ERROR,
      );
    }
  });
});
