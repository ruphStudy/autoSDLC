import { Controller, Get, Inject, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../../auth/guards/jwt-auth.guard';
import { PLANNING_AI_PROVIDER } from '../planning-ai.constants';
import {
  PlanningAIProvider,
  PlanningProviderHealth,
} from '../contracts/planning-provider.interface';

// Authenticated, not public: a real health check makes one minimal live
// OpenAI call, which should not be anonymously triggerable at will.
@UseGuards(JwtAuthGuard)
@Controller('internal/ai/planning')
export class PlanningDiagnosticsController {
  constructor(
    @Inject(PLANNING_AI_PROVIDER)
    private readonly planningAIProvider: PlanningAIProvider,
  ) {}

  @Get('health')
  health(): Promise<PlanningProviderHealth> {
    return this.planningAIProvider.healthCheck();
  }
}
