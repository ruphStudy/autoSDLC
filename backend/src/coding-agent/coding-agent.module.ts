import { Module, Provider } from '@nestjs/common';
import { ProjectsModule } from '../projects/projects.module';
import { ApprovalModule } from '../approval/approval.module';
import { WorkspaceModule } from '../workspace/workspace.module';
import { JobsModule } from '../jobs/jobs.module';
import { CODING_AGENT_PROVIDER } from './coding-agent.constants';
import { CodingAgentConfigService } from './coding-agent.config';
import { CodingAgentProvider } from './contracts/coding-agent-provider.interface';
import {
  CodingAgentError,
  CodingAgentErrorCode,
} from './errors/coding-agent.error';
import { ClaudeCodingAgentProvider } from './providers/claude-coding-agent.provider';
import { CodingAgentService } from './coding-agent.service';
import { CodingAgentController } from './coding-agent.controller';
import { CodingAgentDiagnosticsController } from './diagnostics/coding-agent-diagnostics.controller';
import { CodingAgentExecutionJobHandler } from './handlers/coding-agent-execution.handler';
import { GitService } from '../workspace/git/git.service';

// Exported (not inlined below) so the "unsupported provider fails clearly"
// behavior is directly unit-testable without booting a Nest module. Mirrors
// createPlanningAIProvider (Sprint 3) exactly.
export function createCodingAgentProvider(
  config: CodingAgentConfigService,
  git: GitService,
): CodingAgentProvider {
  switch (config.provider) {
    case 'claude':
      return new ClaudeCodingAgentProvider(config, git);
    default:
      // Defense in depth: env.validation.ts already restricts
      // CODING_AGENT_PROVIDER to known values, so this only fires if that
      // enum grows without a matching branch here.
      throw new CodingAgentError({
        code: CodingAgentErrorCode.CONFIGURATION_ERROR,
        message: `Unsupported coding agent provider: ${config.provider}`,
      });
  }
}

const codingAgentProviderFactory: Provider = {
  provide: CODING_AGENT_PROVIDER,
  useFactory: createCodingAgentProvider,
  inject: [CodingAgentConfigService, GitService],
};

// Imports JobsModule one-directionally (for JobService + JobHandlerRegistry)
// rather than JobsModule importing this module — CodingAgentExecutionJobHandler
// self-registers into the registry via OnModuleInit instead. See
// handlers/coding-agent-execution.handler.ts.
@Module({
  imports: [ProjectsModule, ApprovalModule, WorkspaceModule, JobsModule],
  controllers: [CodingAgentController, CodingAgentDiagnosticsController],
  providers: [
    CodingAgentConfigService,
    codingAgentProviderFactory,
    CodingAgentService,
    CodingAgentExecutionJobHandler,
  ],
  exports: [CODING_AGENT_PROVIDER],
})
export class CodingAgentModule {}
