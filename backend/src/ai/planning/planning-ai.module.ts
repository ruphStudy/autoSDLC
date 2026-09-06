import { Module, Provider } from '@nestjs/common';
import { PlanningAIConfigService } from './planning-ai.config';
import { PLANNING_AI_PROVIDER } from './planning-ai.constants';
import { OpenAIPlanningProvider } from './providers/openai-planning.provider';
import { PlanningAIProvider } from './contracts/planning-provider.interface';
import { PlanningAIError, PlanningErrorCode } from './errors/planning-ai.error';
import { PlanningDiagnosticsController } from './diagnostics/planning-diagnostics.controller';

// Exported (not inlined below) so the "unsupported provider fails clearly"
// behavior is directly unit-testable without booting a Nest module.
export function createPlanningAIProvider(
  config: PlanningAIConfigService,
): PlanningAIProvider {
  switch (config.provider) {
    case 'openai':
      return new OpenAIPlanningProvider(config);
    default:
      // Defense in depth: env.validation.ts already restricts
      // PLANNING_AI_PROVIDER to known values, so this only fires if that
      // enum grows without a matching branch here.
      throw new PlanningAIError({
        code: PlanningErrorCode.CONFIGURATION_ERROR,
        message: `Unsupported planning AI provider: ${config.provider}`,
        provider: config.provider,
        retryable: false,
      });
  }
}

const planningAIProviderFactory: Provider = {
  provide: PLANNING_AI_PROVIDER,
  useFactory: createPlanningAIProvider,
  inject: [PlanningAIConfigService],
};

@Module({
  controllers: [PlanningDiagnosticsController],
  providers: [PlanningAIConfigService, planningAIProviderFactory],
  exports: [PLANNING_AI_PROVIDER],
})
export class PlanningAIModule {}
