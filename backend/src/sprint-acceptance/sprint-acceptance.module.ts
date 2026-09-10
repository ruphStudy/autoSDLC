import { Module } from '@nestjs/common';
import { ProjectsModule } from '../projects/projects.module';
import { WorkspaceModule } from '../workspace/workspace.module';
import { JobsModule } from '../jobs/jobs.module';
import { PlanningAIModule } from '../ai/planning/planning-ai.module';
import { SprintAcceptanceController } from './sprint-acceptance.controller';
import { SprintAcceptanceService } from './sprint-acceptance.service';
import { SprintAcceptanceEvidenceBuilder } from './evidence/evidence-builder.service';
import { SprintAcceptanceJobHandler } from './handlers/sprint-acceptance.handler';

// Deliberately does NOT import SprintExecutionModule/TaskExecutionModule/
// TaskValidationModule — this module only ever READS their Prisma tables
// directly (Sprint/SprintPlan/SprintExecution/Task/TaskExecution/
// ValidationAttempt/Architecture/ProjectAnalysis), the same cross-domain
// direct-table-read precedent used since Sprint 7's ApprovalService and
// most recently Sprint 15's ExecutionMonitorService. This keeps the
// dependency direction one-way: SprintExecutionModule imports THIS module
// (for the Sprint-acceptance dependency gate, item 59), never the reverse —
// importing SprintExecutionModule here would create a cycle.
@Module({
  imports: [ProjectsModule, WorkspaceModule, JobsModule, PlanningAIModule],
  controllers: [SprintAcceptanceController],
  providers: [
    SprintAcceptanceService,
    SprintAcceptanceEvidenceBuilder,
    SprintAcceptanceJobHandler,
  ],
  exports: [SprintAcceptanceService],
})
export class SprintAcceptanceModule {}
