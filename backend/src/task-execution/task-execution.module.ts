import { Module } from '@nestjs/common';
import { ProjectsModule } from '../projects/projects.module';
import { ApprovalModule } from '../approval/approval.module';
import { WorkspaceModule } from '../workspace/workspace.module';
import { JobsModule } from '../jobs/jobs.module';
import { TaskInstructionModule } from '../task-instruction/task-instruction.module';
import { CodingAgentModule } from '../coding-agent/coding-agent.module';
import { TaskExecutionController } from './task-execution.controller';
import { TaskExecutionService } from './task-execution.service';
import { TaskExecutionConfigService } from './task-execution.config';
import { TaskExecutionJobHandler } from './handlers/task-execution.handler';

// Imports JobsModule one-directionally (for JobService + JobHandlerRegistry)
// rather than JobsModule importing this module — TaskExecutionJobHandler
// self-registers into the registry via OnModuleInit instead. See
// handlers/task-execution.handler.ts. Imports CodingAgentModule and
// TaskInstructionModule the same way — this module is the top of the
// orchestration stack; nothing it imports ever needs to import it back.
@Module({
  imports: [
    ProjectsModule,
    ApprovalModule,
    WorkspaceModule,
    JobsModule,
    TaskInstructionModule,
    CodingAgentModule,
  ],
  controllers: [TaskExecutionController],
  providers: [
    TaskExecutionConfigService,
    TaskExecutionService,
    TaskExecutionJobHandler,
  ],
  exports: [TaskExecutionService],
})
export class TaskExecutionModule {}
