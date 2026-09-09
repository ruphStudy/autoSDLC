import { Controller, Get, Inject, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CODING_AGENT_PROVIDER } from '../coding-agent.constants';
import { CodingAgentProvider } from '../contracts/coding-agent-provider.interface';
import { CodingAgentHealth } from '../contracts/coding-agent-result';

// Authenticated, not public — mirrors PlanningDiagnosticsController exactly.
// The health check itself never runs a real coding task (item 48).
@UseGuards(JwtAuthGuard)
@Controller('internal/ai/coding')
export class CodingAgentDiagnosticsController {
  constructor(
    @Inject(CODING_AGENT_PROVIDER)
    private readonly codingAgentProvider: CodingAgentProvider,
  ) {}

  @Get('health')
  health(): Promise<CodingAgentHealth> {
    return this.codingAgentProvider.healthCheck();
  }
}
