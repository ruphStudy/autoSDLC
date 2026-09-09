import { Module } from '@nestjs/common';
import { ProjectsModule } from '../projects/projects.module';
import { ApprovalModule } from '../approval/approval.module';
import { WorkspaceModule } from '../workspace/workspace.module';
import { PlanningAIModule } from '../ai/planning/planning-ai.module';
import { TaskInstructionController } from './task-instruction.controller';
import { TaskInstructionService } from './task-instruction.service';
import { TaskInstructionConfigService } from './task-instruction.config';
import { TaskContextBuilder } from './context/task-context-builder.service';
import { RepositoryTreeService } from './repository/repository-tree.service';

// No JobsModule dependency: instruction generation is a synchronous service
// method (item 74) — Sprint 12 calls it directly as part of its own
// execution flow, rather than this module owning a separate background-job
// orchestration path for the same work.
@Module({
  imports: [ProjectsModule, ApprovalModule, WorkspaceModule, PlanningAIModule],
  controllers: [TaskInstructionController],
  providers: [
    TaskInstructionConfigService,
    RepositoryTreeService,
    TaskContextBuilder,
    TaskInstructionService,
  ],
  exports: [TaskInstructionService],
})
export class TaskInstructionModule {}
