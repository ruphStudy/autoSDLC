import { Module } from '@nestjs/common';
import { ProjectsModule } from '../projects/projects.module';
import { ApprovalModule } from '../approval/approval.module';
import { WorkspaceModule } from '../workspace/workspace.module';
import { JobsModule } from '../jobs/jobs.module';
import { TaskValidationController } from './task-validation.controller';
import { TaskValidationService } from './task-validation.service';
import { TaskValidationConfigService } from './task-validation.config';
import { RepositoryToolingDetector } from './tooling/repository-tooling-detector';
import { ValidationPlanResolver } from './tooling/validation-plan-resolver';
import { ValidationCommandExecutor } from './execution/validation-command-executor';
import { TaskValidationJobHandler } from './handlers/task-validation.handler';

// Imports JobsModule one-directionally (for JobService + JobHandlerRegistry)
// rather than JobsModule importing this module — TaskValidationJobHandler
// self-registers into the registry via OnModuleInit instead. Deliberately
// does NOT import TaskExecutionModule or CodingAgentModule — this module
// reads the TaskExecution/AgentJob tables directly via PrismaService, the
// same sibling-module pattern ApprovalService uses for ProjectAnalysis/
// Architecture/SprintPlan.
@Module({
  imports: [ProjectsModule, ApprovalModule, WorkspaceModule, JobsModule],
  controllers: [TaskValidationController],
  providers: [
    TaskValidationConfigService,
    RepositoryToolingDetector,
    ValidationPlanResolver,
    ValidationCommandExecutor,
    TaskValidationService,
    TaskValidationJobHandler,
  ],
  exports: [TaskValidationService],
})
export class TaskValidationModule {}
