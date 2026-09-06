import { z } from 'zod';
import {
  AuthenticationError,
  InternalServerError,
  RateLimitError,
} from 'openai';
import { PlanningAIConfigService } from '../planning-ai.config';
import { PlanningOperation } from '../planning-ai.constants';
import {
  PlanningErrorCode,
  PlanningAIError,
} from '../errors/planning-ai.error';
import { OpenAIPlanningProvider } from './openai-planning.provider';

const mockCreate = jest.fn();

// jest.mock calls are hoisted above imports by ts-jest/babel-jest, so this
// still applies before OpenAIPlanningProvider's `new OpenAI(...)` runs.
jest.mock('openai', () => {
  const actual = jest.requireActual('openai');
  const ctor = jest.fn().mockImplementation(() => ({
    chat: { completions: { create: mockCreate } },
  }));
  return { ...actual, default: ctor, OpenAI: ctor };
});

const TestSchema = z.object({ summary: z.string(), score: z.number() });

function headers(entries: Record<string, string> = {}): Headers {
  return new Headers(entries);
}

function fakeConfig(
  overrides: Partial<PlanningAIConfigService['openai']> = {},
): PlanningAIConfigService {
  return {
    provider: 'openai',
    openai: {
      apiKey: 'sk-test',
      model: 'gpt-4o-mini',
      timeoutMs: 5000,
      maxRetries: 2,
      temperature: 0.2,
      ...overrides,
    },
  } as PlanningAIConfigService;
}

function fakeCompletion(
  content: unknown,
  overrides: Record<string, unknown> = {},
) {
  return {
    id: 'chatcmpl-123',
    model: 'gpt-4o-mini',
    choices: [
      {
        finish_reason: 'stop',
        message: {
          content:
            typeof content === 'string' ? content : JSON.stringify(content),
          refusal: null,
        },
      },
    ],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    ...overrides,
  };
}

function baseRequest(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    operation: PlanningOperation.GENERAL_PLANNING,
    systemPrompt: 'system',
    userPrompt: 'user',
    schema: TestSchema,
    schemaName: 'test_schema',
    ...overrides,
  } as const;
}

describe('OpenAIPlanningProvider', () => {
  beforeEach(() => {
    mockCreate.mockReset();
  });

  it('returns validated data with usage and metadata on success', async () => {
    mockCreate.mockResolvedValueOnce(
      fakeCompletion({ summary: 'looks good', score: 9 }),
    );
    const provider = new OpenAIPlanningProvider(fakeConfig());

    const result = await provider.generateStructuredOutput(baseRequest());

    expect(result.data).toEqual({ summary: 'looks good', score: 9 });
    expect(result.usage).toEqual({
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
    });
    expect(result.metadata).toMatchObject({
      provider: 'openai',
      model: 'gpt-4o-mini',
      operation: PlanningOperation.GENERAL_PLANNING,
      attempts: 1,
      requestId: 'chatcmpl-123',
    });
    expect(result.metadata.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('rejects with INVALID_STRUCTURED_RESPONSE when content is not JSON', async () => {
    mockCreate.mockResolvedValueOnce(fakeCompletion('not json'));
    const provider = new OpenAIPlanningProvider(fakeConfig());

    await expect(
      provider.generateStructuredOutput(baseRequest()),
    ).rejects.toMatchObject({
      code: PlanningErrorCode.INVALID_STRUCTURED_RESPONSE,
    });
  });

  it('rejects with INVALID_STRUCTURED_RESPONSE when the schema does not match', async () => {
    mockCreate.mockResolvedValueOnce(
      fakeCompletion({ summary: 'missing score' }),
    );
    const provider = new OpenAIPlanningProvider(fakeConfig());

    await expect(
      provider.generateStructuredOutput(baseRequest()),
    ).rejects.toMatchObject({
      code: PlanningErrorCode.INVALID_STRUCTURED_RESPONSE,
    });
  });

  it('does not retry an invalid structured response', async () => {
    mockCreate.mockResolvedValue(fakeCompletion({ summary: 'missing score' }));
    const provider = new OpenAIPlanningProvider(fakeConfig({ maxRetries: 2 }));

    await expect(
      provider.generateStructuredOutput(baseRequest()),
    ).rejects.toBeInstanceOf(PlanningAIError);
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it('maps a content refusal to CONTENT_REFUSED', async () => {
    mockCreate.mockResolvedValueOnce({
      id: 'chatcmpl-1',
      model: 'gpt-4o-mini',
      choices: [
        {
          finish_reason: 'stop',
          message: { content: null, refusal: 'cannot help with that' },
        },
      ],
      usage: undefined,
    });
    const provider = new OpenAIPlanningProvider(fakeConfig());

    await expect(
      provider.generateStructuredOutput(baseRequest()),
    ).rejects.toMatchObject({
      code: PlanningErrorCode.CONTENT_REFUSED,
    });
  });

  it('maps a length finish_reason to CONTEXT_LIMIT', async () => {
    mockCreate.mockResolvedValueOnce(
      fakeCompletion(null, {
        choices: [
          {
            finish_reason: 'length',
            message: { content: null, refusal: null },
          },
        ],
      }),
    );
    const provider = new OpenAIPlanningProvider(fakeConfig());

    await expect(
      provider.generateStructuredOutput(baseRequest()),
    ).rejects.toMatchObject({
      code: PlanningErrorCode.CONTEXT_LIMIT,
    });
  });

  it('retries a retryable provider error and succeeds', async () => {
    mockCreate
      .mockRejectedValueOnce(
        new RateLimitError(429, {}, 'slow down', headers()),
      )
      .mockResolvedValueOnce(fakeCompletion({ summary: 'ok', score: 1 }));
    const provider = new OpenAIPlanningProvider(fakeConfig({ maxRetries: 2 }));

    const result = await provider.generateStructuredOutput(baseRequest());

    expect(result.data).toEqual({ summary: 'ok', score: 1 });
    expect(result.metadata.attempts).toBe(2);
    expect(mockCreate).toHaveBeenCalledTimes(2);
  }, 10000);

  it('does not retry a non-retryable authentication error', async () => {
    mockCreate.mockRejectedValue(
      new AuthenticationError(401, {}, 'bad key', headers()),
    );
    const provider = new OpenAIPlanningProvider(fakeConfig({ maxRetries: 2 }));

    await expect(
      provider.generateStructuredOutput(baseRequest()),
    ).rejects.toMatchObject({
      code: PlanningErrorCode.AUTHENTICATION_ERROR,
    });
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it('exhausts the retry budget on repeated server errors and normalizes the final error', async () => {
    mockCreate.mockRejectedValue(
      new InternalServerError(500, {}, 'oops', headers()),
    );
    const provider = new OpenAIPlanningProvider(fakeConfig({ maxRetries: 1 }));

    await expect(
      provider.generateStructuredOutput(baseRequest()),
    ).rejects.toMatchObject({
      code: PlanningErrorCode.PROVIDER_UNAVAILABLE,
    });
    // initial attempt + 1 configured retry
    expect(mockCreate).toHaveBeenCalledTimes(2);
  }, 10000);

  it('normalizes a timeout to TIMEOUT without hanging', async () => {
    mockCreate.mockImplementation(
      (_body: unknown, options: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          options.signal.addEventListener('abort', () =>
            reject(new Error('aborted')),
          );
        }),
    );
    const provider = new OpenAIPlanningProvider(
      fakeConfig({ timeoutMs: 30, maxRetries: 0 }),
    );

    await expect(
      provider.generateStructuredOutput(baseRequest()),
    ).rejects.toMatchObject({
      code: PlanningErrorCode.TIMEOUT,
    });
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  describe('healthCheck', () => {
    it('reports reachable=true on a successful minimal call', async () => {
      mockCreate.mockResolvedValueOnce(fakeCompletion({ status: 'ok' }));
      const provider = new OpenAIPlanningProvider(fakeConfig());

      const health = await provider.healthCheck();

      expect(health).toMatchObject({
        provider: 'openai',
        configured: true,
        reachable: true,
      });
      expect(health.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it('reports reachable=false with an errorCode instead of throwing', async () => {
      mockCreate.mockRejectedValue(
        new AuthenticationError(401, {}, 'bad key', headers()),
      );
      const provider = new OpenAIPlanningProvider(fakeConfig());

      const health = await provider.healthCheck();

      expect(health).toMatchObject({
        provider: 'openai',
        configured: true,
        reachable: false,
        errorCode: PlanningErrorCode.AUTHENTICATION_ERROR,
      });
    });
  });
});
