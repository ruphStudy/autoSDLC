import { createCodingAgentProvider } from './coding-agent.module';
import { ClaudeCodingAgentProvider } from './providers/claude-coding-agent.provider';
import { CodingAgentConfigService } from './coding-agent.config';
import {
  CodingAgentError,
  CodingAgentErrorCode,
} from './errors/coding-agent.error';
import { GitService } from '../workspace/git/git.service';

describe('createCodingAgentProvider', () => {
  const git = {} as GitService;

  it('creates a ClaudeCodingAgentProvider when provider is "claude"', () => {
    const config = {
      provider: 'claude',
      claude: {
        apiKey: 'sk-ant-test',
        model: 'claude-sonnet-5',
        maxTurns: 25,
        executionTimeoutMs: 900000,
        maxOutputBytes: 1048576,
      },
    } as CodingAgentConfigService;

    expect(createCodingAgentProvider(config, git)).toBeInstanceOf(
      ClaudeCodingAgentProvider,
    );
  });

  it('fails clearly for an unsupported provider instead of silently falling back', () => {
    const config = {
      provider: 'unsupported-provider',
    } as unknown as CodingAgentConfigService;

    expect(() => createCodingAgentProvider(config, git)).toThrow(
      CodingAgentError,
    );
    try {
      createCodingAgentProvider(config, git);
    } catch (error) {
      expect((error as CodingAgentError).code).toBe(
        CodingAgentErrorCode.CONFIGURATION_ERROR,
      );
    }
  });
});
