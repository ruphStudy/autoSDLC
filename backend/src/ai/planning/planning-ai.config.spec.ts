import { PlanningAIConfigService } from './planning-ai.config';
import { PlanningAIError, PlanningErrorCode } from './errors/planning-ai.error';

function fakeConfigService(values: Record<string, unknown>) {
  return { get: (key: string) => values[key] } as any;
}

describe('PlanningAIConfigService', () => {
  it('resolves the openai config from ConfigService', () => {
    const service = new PlanningAIConfigService(
      fakeConfigService({
        PLANNING_AI_PROVIDER: 'openai',
        OPENAI_API_KEY: 'sk-test',
        OPENAI_PLANNING_MODEL: 'gpt-4o-mini',
        OPENAI_PLANNING_TIMEOUT_MS: 90000,
        OPENAI_PLANNING_MAX_RETRIES: 2,
        OPENAI_PLANNING_TEMPERATURE: 0.2,
      }),
    );

    expect(service.provider).toBe('openai');
    expect(service.openai).toEqual({
      apiKey: 'sk-test',
      model: 'gpt-4o-mini',
      timeoutMs: 90000,
      maxRetries: 2,
      temperature: 0.2,
    });
  });

  it('throws a clear CONFIGURATION_ERROR when the API key is missing', () => {
    try {
      new PlanningAIConfigService(
        fakeConfigService({
          PLANNING_AI_PROVIDER: 'openai',
          OPENAI_API_KEY: '',
          OPENAI_PLANNING_MODEL: 'gpt-4o-mini',
          OPENAI_PLANNING_TIMEOUT_MS: 90000,
          OPENAI_PLANNING_MAX_RETRIES: 2,
          OPENAI_PLANNING_TEMPERATURE: 0.2,
        }),
      );
      throw new Error('expected constructor to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(PlanningAIError);
      expect((error as PlanningAIError).code).toBe(
        PlanningErrorCode.CONFIGURATION_ERROR,
      );
    }
  });
});
