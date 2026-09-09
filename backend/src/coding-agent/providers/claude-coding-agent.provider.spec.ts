import { query } from '@anthropic-ai/claude-agent-sdk';
import { ClaudeCodingAgentProvider } from './claude-coding-agent.provider';
import { CodingAgentConfigService } from '../coding-agent.config';
import { GitService } from '../../workspace/git/git.service';
import {
  CodingAgentError,
  CodingAgentErrorCode,
} from '../errors/coding-agent.error';
import { CodingAgentExecutionRequest } from '../contracts/coding-agent-request';

const mockedQuery = jest.mocked(query);

function buildConfig(
  overrides: Partial<CodingAgentConfigService['claude']> = {},
): CodingAgentConfigService {
  return {
    provider: 'claude',
    claude: {
      apiKey: 'sk-ant-test',
      model: 'claude-sonnet-5',
      maxTurns: 25,
      executionTimeoutMs: 900000,
      maxOutputBytes: 1048576,
      ...overrides,
    },
  } as CodingAgentConfigService;
}

// Turns a fixed array of SDKMessage-shaped objects into the async generator
// shape query() returns. When `hangUntilAbort` is set, it yields the given
// messages and then blocks — exactly like the real SDK would keep running
// until *it* observes options.abortController and stops — so the signal
// must be passed in explicitly here to end the hang, the same way the real
// subprocess would react to it.
function fakeQuery(
  messages: unknown[],
  options?: { hangUntilAbort?: AbortSignal },
) {
  return (async function* () {
    for (const message of messages) {
      yield message;
    }
    const signal = options?.hangUntilAbort;
    if (signal) {
      await new Promise<void>((resolve) => {
        if (signal.aborted) {
          resolve();
          return;
        }
        signal.addEventListener('abort', () => resolve(), { once: true });
      });
    }
  })();
}

function assistantToolUse(
  name: string,
  input: Record<string, unknown>,
  id = 'tool-1',
) {
  return {
    type: 'assistant',
    message: { content: [{ type: 'tool_use', id, name, input }] },
    parent_tool_use_id: null,
    uuid: 'u1',
    session_id: 's1',
  };
}

function toolResult(toolUseId: string, isError = false) {
  return {
    type: 'user',
    message: {
      content: [
        { type: 'tool_result', tool_use_id: toolUseId, is_error: isError },
      ],
    },
    parent_tool_use_id: null,
    uuid: 'u2',
    session_id: 's1',
  };
}

function successResult(overrides: Record<string, unknown> = {}) {
  return {
    type: 'result',
    subtype: 'success',
    duration_ms: 100,
    duration_api_ms: 80,
    is_error: false,
    num_turns: 3,
    result: 'Done. Inspected the repository.',
    stop_reason: null,
    total_cost_usd: 0.01,
    usage: {
      input_tokens: 100,
      output_tokens: 50,
      cache_read_input_tokens: 10,
      cache_creation_input_tokens: 5,
    },
    modelUsage: {},
    permission_denials: [],
    errors: [],
    uuid: 'u3',
    session_id: 'session-123',
    ...overrides,
  };
}

function errorResult(subtype: string, overrides: Record<string, unknown> = {}) {
  return {
    type: 'result',
    subtype,
    duration_ms: 100,
    duration_api_ms: 80,
    is_error: true,
    num_turns: 1,
    stop_reason: null,
    total_cost_usd: 0,
    usage: { input_tokens: 10, output_tokens: 0 },
    modelUsage: {},
    permission_denials: [],
    errors: ['boom'],
    uuid: 'u3',
    session_id: 'session-err',
    ...overrides,
  };
}

function baseRequest(
  overrides: Partial<CodingAgentExecutionRequest> = {},
): CodingAgentExecutionRequest {
  return {
    projectId: 'project-1',
    instruction: 'Inspect the repository and summarize it.',
    workspacePath: '/workspaces/project-1',
    ...overrides,
  };
}

describe('ClaudeCodingAgentProvider', () => {
  let git: { getStatus: jest.Mock };
  let provider: ClaudeCodingAgentProvider;

  beforeEach(() => {
    mockedQuery.mockReset();
    git = {
      getStatus: jest.fn().mockResolvedValue({ clean: true, files: [] }),
    };
    provider = new ClaudeCodingAgentProvider(
      buildConfig(),
      git as unknown as GitService,
    );
  });

  describe('executeTask', () => {
    it('maps a successful run into a structured SUCCEEDED result with usage and metadata', async () => {
      mockedQuery.mockImplementation(
        () => fakeQuery([successResult()]) as never,
      );

      const result = await provider.executeTask(baseRequest());

      expect(result.status).toBe('SUCCEEDED');
      expect(result.summary).toBe('Done. Inspected the repository.');
      expect(result.usage).toEqual({
        inputTokens: 100,
        outputTokens: 50,
        cacheReadInputTokens: 10,
        cacheCreationInputTokens: 5,
      });
      expect(result.metadata).toMatchObject({
        provider: 'claude',
        model: 'claude-sonnet-5',
        turns: 3,
        providerRequestId: 'session-123',
      });
      expect(typeof result.metadata.durationMs).toBe('number');
    });

    it('captures tool activity and pairs Bash commands with their result', async () => {
      git.getStatus.mockResolvedValue({
        clean: false,
        files: [{ path: 'README.md', status: 'MODIFIED', staged: false }],
      });
      mockedQuery.mockImplementation(
        () =>
          fakeQuery([
            assistantToolUse('Read', { file_path: 'README.md' }, 'tool-read'),
            toolResult('tool-read'),
            assistantToolUse('Bash', { command: 'npm test' }, 'tool-bash'),
            toolResult('tool-bash'),
            successResult(),
          ]) as never,
      );

      const result = await provider.executeTask(baseRequest());

      expect(result.toolActivities).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'Read' }),
          expect.objectContaining({ name: 'Bash' }),
        ]),
      );
      expect(result.commandActivities).toEqual([
        expect.objectContaining({ command: 'npm test', success: true }),
      ]);
      expect(result.changedFiles).toEqual([
        { path: 'README.md', changeType: 'MODIFIED' },
      ]);
    });

    it('marks a failed Bash tool_result as unsuccessful', async () => {
      mockedQuery.mockImplementation(
        () =>
          fakeQuery([
            assistantToolUse('Bash', { command: 'npm test' }, 'tool-bash'),
            toolResult('tool-bash', true),
            successResult(),
          ]) as never,
      );

      const result = await provider.executeTask(baseRequest());
      expect(result.commandActivities[0]).toMatchObject({
        command: 'npm test',
        success: false,
      });
    });

    it('never lets a request exceed the configured max turns cap', async () => {
      mockedQuery.mockImplementation(
        () => fakeQuery([successResult()]) as never,
      );

      await provider.executeTask(
        baseRequest({ constraints: { maxTurns: 9999 } }),
      );

      const optionsArg = mockedQuery.mock.calls[0][0].options;
      expect(optionsArg?.maxTurns).toBe(25); // the configured CLAUDE_MAX_TURNS cap
    });

    it('maps error_max_turns to MAX_TURNS_EXCEEDED', async () => {
      mockedQuery.mockImplementation(
        () => fakeQuery([errorResult('error_max_turns')]) as never,
      );

      const result = await provider.executeTask(baseRequest());
      expect(result.status).toBe('FAILED');
      expect(result.errorCode).toBe(CodingAgentErrorCode.MAX_TURNS_EXCEEDED);
    });

    it('maps an authentication_failed assistant error to AUTHENTICATION_ERROR', async () => {
      mockedQuery.mockImplementation(
        () =>
          fakeQuery([
            {
              type: 'assistant',
              message: { content: [] },
              parent_tool_use_id: null,
              error: 'authentication_failed',
              uuid: 'u',
              session_id: 's',
            },
            errorResult('error_during_execution'),
          ]) as never,
      );

      const result = await provider.executeTask(baseRequest());
      expect(result.status).toBe('FAILED');
      expect(result.errorCode).toBe(CodingAgentErrorCode.AUTHENTICATION_ERROR);
    });

    it('reports TIMEOUT and returns whatever was captured before the timeout fired', async () => {
      mockedQuery.mockImplementation(
        (params) =>
          fakeQuery([assistantToolUse('Read', { file_path: 'README.md' })], {
            hangUntilAbort: params.options?.abortController?.signal,
          }) as never,
      );

      const result = await provider.executeTask(
        baseRequest({ constraints: { timeoutMs: 50 } }),
      );

      expect(result.status).toBe('FAILED');
      expect(result.errorCode).toBe(CodingAgentErrorCode.TIMEOUT);
      expect(result.toolActivities).toHaveLength(1);
    });

    it('reports CANCELLED when the caller aborts via its own signal', async () => {
      const controller = new AbortController();
      mockedQuery.mockImplementation((params) => {
        // The provider already wired its internal abortController to this
        // external signal by the time query() is called — abort here to
        // simulate the caller cancelling mid-flight.
        controller.abort();
        return fakeQuery([], {
          hangUntilAbort: params.options?.abortController?.signal,
        }) as never;
      });

      const result = await provider.executeTask(
        baseRequest({
          signal: controller.signal,
          constraints: { timeoutMs: 5000 },
        }),
      );

      expect(result.status).toBe('CANCELLED');
      expect(result.errorCode).toBe(CodingAgentErrorCode.CANCELLED);
    });

    it('rejects (throws) rather than returns a result when nothing could run at all', async () => {
      mockedQuery.mockImplementation(() => {
        throw new Error('spawn ENOENT: claude executable not found');
      });

      await expect(provider.executeTask(baseRequest())).rejects.toBeInstanceOf(
        CodingAgentError,
      );
    });

    it('rejects for an empty instruction without ever calling query()', async () => {
      await expect(
        provider.executeTask(baseRequest({ instruction: '   ' })),
      ).rejects.toMatchObject({
        code: CodingAgentErrorCode.INVALID_REQUEST,
      });
      expect(mockedQuery).not.toHaveBeenCalled();
    });

    it('truncates an oversized summary at the configured byte limit', async () => {
      const smallProvider = new ClaudeCodingAgentProvider(
        buildConfig({ maxOutputBytes: 20 }),
        git as unknown as GitService,
      );
      mockedQuery.mockImplementation(
        () => fakeQuery([successResult({ result: 'x'.repeat(1000) })]) as never,
      );

      const result = await smallProvider.executeTask(baseRequest());
      const maxExpectedBytes = 20 + Buffer.byteLength('\n…(truncated)', 'utf8');
      expect(Buffer.byteLength(result.summary, 'utf8')).toBeLessThanOrEqual(
        maxExpectedBytes,
      );
      expect(result.summary).toContain('truncated');
    });

    it('sets cwd to the request workspacePath, never the orchestrator process cwd', async () => {
      mockedQuery.mockImplementation(
        () => fakeQuery([successResult()]) as never,
      );
      await provider.executeTask(
        baseRequest({ workspacePath: '/workspaces/project-42' }),
      );
      expect(mockedQuery.mock.calls[0][0].options?.cwd).toBe(
        '/workspaces/project-42',
      );
    });

    it('denies a Bash command that violates the command policy via canUseTool', async () => {
      mockedQuery.mockImplementation(
        () => fakeQuery([successResult()]) as never,
      );
      await provider.executeTask(baseRequest());

      const options = mockedQuery.mock.calls[0][0].options!;
      const decision = await options.canUseTool!(
        'Bash',
        { command: 'git push origin main' },
        {
          signal: new AbortController().signal,
          toolUseID: 't1',
          requestId: 'r1',
        },
      );
      expect(decision).toMatchObject({ behavior: 'deny' });
    });

    it('denies a file tool whose path escapes the workspace via canUseTool', async () => {
      mockedQuery.mockImplementation(
        () => fakeQuery([successResult()]) as never,
      );
      await provider.executeTask(
        baseRequest({ workspacePath: '/workspaces/project-1' }),
      );

      const options = mockedQuery.mock.calls[0][0].options!;
      const decision = await options.canUseTool!(
        'Read',
        { file_path: '/etc/passwd' },
        {
          signal: new AbortController().signal,
          toolUseID: 't1',
          requestId: 'r1',
        },
      );
      expect(decision).toMatchObject({ behavior: 'deny' });
    });
  });

  describe('healthCheck', () => {
    it('reports not configured when neither credential is set', async () => {
      const unconfigured = new ClaudeCodingAgentProvider(
        buildConfig({ apiKey: undefined }),
        git as unknown as GitService,
      );
      const health = await unconfigured.healthCheck();
      expect(health).toMatchObject({ provider: 'claude', configured: false });
      expect(mockedQuery).not.toHaveBeenCalled();
    });

    it('reports reachable when a minimal tool-free query succeeds', async () => {
      mockedQuery.mockImplementation(
        () => fakeQuery([successResult()]) as never,
      );
      const health = await provider.healthCheck();
      expect(health).toMatchObject({
        provider: 'claude',
        configured: true,
        reachable: true,
      });
      expect(mockedQuery.mock.calls[0][0].options?.tools).toEqual([]);
    });

    it('reports unreachable with a normalized error code on auth failure', async () => {
      mockedQuery.mockImplementation(() => {
        throw new Error('authentication failed');
      });
      const health = await provider.healthCheck();
      expect(health.reachable).toBe(false);
      expect(health.errorCode).toBe(CodingAgentErrorCode.AUTHENTICATION_ERROR);
    });
  });
});
