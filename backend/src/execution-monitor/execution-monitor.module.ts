import { Module } from '@nestjs/common';
import { ProjectsModule } from '../projects/projects.module';
import { WorkspaceModule } from '../workspace/workspace.module';
import { SprintExecutionModule } from '../sprint-execution/sprint-execution.module';
import { ExecutionMonitorController } from './execution-monitor.controller';
import { ExecutionMonitorService } from './execution-monitor.service';

// Deliberately does NOT import TaskExecutionModule/TaskValidationModule —
// unlike SprintExecutionModule (which calls their services to actually
// orchestrate), this module only ever reads their Prisma tables directly
// (the same cross-domain direct-table-read precedent used since Sprint 7's
// ApprovalService). SprintExecutionModule is imported only to reuse its
// existing, already-public getEligibility() read for "next Sprint ready to
// start" (item 105) — never to duplicate or call its mutating methods.
@Module({
  imports: [ProjectsModule, WorkspaceModule, SprintExecutionModule],
  controllers: [ExecutionMonitorController],
  providers: [ExecutionMonitorService],
  exports: [ExecutionMonitorService],
})
export class ExecutionMonitorModule {}
