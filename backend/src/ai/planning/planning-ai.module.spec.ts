import { createPlanningAIProvider } from './planning-ai.module';
import { OpenAIPlanningProvider } from './providers/openai-planning.provider';
import { PlanningAIConfigService } from './planning-ai.config';
import { PlanningAIError, PlanningErrorCode } from './errors/planning-ai.error';

describe('createPlanningAIProvider', () => {
  it('creates an OpenAIPlanningProvider when provider is "openai"', () => {
    const config = {
      provider: 'openai',
      openai: {
        apiKey: 'sk-test',
        model: 'gpt-4o-mini',
        timeoutMs: 90000,
        maxRetries: 2,
        temperature: 0.2,
      },
    } as PlanningAIConfigService;

    expect(createPlanningAIProvider(config)).toBeInstanceOf(
      OpenAIPlanningProvider,
    );
  });

  it('fails clearly for an unsupported provider instead of silently falling back', () => {
    const config = {
      provider: 'unsupported-provider',
    } as unknown as PlanningAIConfigService;

    expect(() => createPlanningAIProvider(config)).toThrow(PlanningAIError);
    try {
      createPlanningAIProvider(config);
    } catch (error) {
      expect((error as PlanningAIError).code).toBe(
        PlanningErrorCode.CONFIGURATION_ERROR,
      );
    }
  });
});
