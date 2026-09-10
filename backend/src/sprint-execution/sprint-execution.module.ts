import { Module } from '@nestjs/common';
import { ProjectsModule } from '../projects/projects.module';
import { ApprovalModule } from '../approval/approval.module';
import { WorkspaceModule } from '../workspace/workspace.module';
import { JobsModule } from '../jobs/jobs.module';
import { TaskExecutionModule } from '../task-execution/task-execution.module';
import { TaskValidationModule } from '../task-validation/task-validation.module';
import { SprintAcceptanceModule } from '../sprint-acceptance/sprint-acceptance.module';
import { SprintExecutionController } from './sprint-execution.controller';
import { SprintExecutionService } from './sprint-execution.service';
import { SprintExecutionJobHandler } from './handlers/sprint-execution.handler';

// The only Sprint 14 module that directly imports sibling execution
// modules (TaskExecutionModule/TaskValidationModule) rather than reading
// their tables via Prisma — deliberately: the whole point of the Sprint
// Orchestrator is to CALL TaskExecutionService/TaskValidationService's
// real methods, never to reimplement their eligibility/execution/
// validation logic (the master prompt's central "reuse, don't duplicate"
// principle). No cycle results: neither of those modules imports this one
// back. Imports JobsModule one-directionally for JobService +
// JobHandlerRegistry — SprintExecutionJobHandler self-registers via
// OnModuleInit exactly like every other job handler in this codebase.
// SprintAcceptanceModule (Sprint 16) is imported one-directionally too,
// purely to reuse its existing getGateStatus() read for the dependent-
// Sprint acceptance gate (item 59) — never to duplicate acceptance logic
// here. No cycle: SprintAcceptanceModule never imports this module back.
@Module({
  imports: [
    ProjectsModule,
    ApprovalModule,
    WorkspaceModule,
    JobsModule,
    TaskExecutionModule,
    TaskValidationModule,
    SprintAcceptanceModule,
  ],
  controllers: [SprintExecutionController],
  providers: [SprintExecutionService, SprintExecutionJobHandler],
  exports: [SprintExecutionService],
})
export class SprintExecutionModule {}
