import { Module } from '@nestjs/common';
import { ProjectsModule } from '../projects/projects.module';
import { ApprovalModule } from '../approval/approval.module';
import { JobsModule } from '../jobs/jobs.module';
import { WorkspaceController } from './workspace.controller';
import { WorkspaceService } from './workspace.service';
import { WorkspaceConfigService } from './workspace.config';
import { WorkspacePathService } from './workspace-path.service';
import { GitService } from './git/git.service';
import { WorkspacePrepareJobHandler } from './handlers/workspace-prepare.handler';

// Imports JobsModule one-directionally (for JobService + JobHandlerRegistry)
// rather than JobsModule importing this module — WorkspacePrepareJobHandler
// self-registers into the registry via OnModuleInit instead. See
// workspace-prepare.handler.ts.
@Module({
  imports: [ProjectsModule, ApprovalModule, JobsModule],
  controllers: [WorkspaceController],
  providers: [
    WorkspaceConfigService,
    WorkspacePathService,
    GitService,
    WorkspaceService,
    WorkspacePrepareJobHandler,
  ],
  // GitService is also exported for Sprint 10's coding-agent module, which
  // needs it for pre-execution dirty-checks and post-execution changed-file
  // detection — see coding-agent/providers/git-change-detection.util.ts.
  exports: [WorkspaceService, GitService],
})
export class WorkspaceModule {}
