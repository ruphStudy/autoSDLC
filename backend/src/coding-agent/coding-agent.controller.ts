import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { SafeUser } from '../auth/types/auth.types';
import { CodingAgentService } from './coding-agent.service';
import { JobRecord } from '../jobs/types/job.types';
import { AgentJobRecord } from './types/agent-job.types';

// No route here ever accepts an instruction/prompt from the client (item
// 51/91) — POST .../diagnostic always runs the same fixed, backend-generated
// instruction. There is deliberately no "run arbitrary instruction" endpoint.
@UseGuards(JwtAuthGuard)
@Controller('projects/:projectId')
export class CodingAgentController {
  constructor(private readonly codingAgentService: CodingAgentService) {}

  @Post('coding-agent/diagnostic')
  @HttpCode(HttpStatus.ACCEPTED)
  runDiagnostic(
    @CurrentUser() user: SafeUser,
    @Param('projectId') projectId: string,
  ): Promise<{ agentJob: AgentJobRecord; job: JobRecord }> {
    return this.codingAgentService.runDiagnostic(user.id, projectId);
  }

  @Get('agent-jobs')
  list(
    @CurrentUser() user: SafeUser,
    @Param('projectId') projectId: string,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
  ): Promise<AgentJobRecord[]> {
    return this.codingAgentService.list(user.id, projectId, limit);
  }

  @Get('agent-jobs/:agentJobId')
  getById(
    @CurrentUser() user: SafeUser,
    @Param('projectId') projectId: string,
    @Param('agentJobId') agentJobId: string,
  ): Promise<AgentJobRecord> {
    return this.codingAgentService.getById(user.id, projectId, agentJobId);
  }
}
