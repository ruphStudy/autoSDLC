import { Module } from '@nestjs/common';
import { ProjectsModule } from '../projects/projects.module';
import { ApprovalModule } from '../approval/approval.module';
import { WorkspaceModule } from '../workspace/workspace.module';
import { SprintAcceptanceModule } from '../sprint-acceptance/sprint-acceptance.module';
import { ProjectDeliveryController } from './project-delivery.controller';
import { ProjectDeliveryService } from './project-delivery.service';
import { ProjectDeliveryEvidenceBuilder } from './evidence/evidence-builder.service';

// Deliberately does NOT import SprintExecutionModule/TaskExecutionModule/
// TaskValidationModule — this module only ever READS their Prisma tables
// directly (Sprint/SprintPlan/SprintExecution/Task/TaskExecution/
// ValidationAttempt/Architecture/ProjectAnalysis/AgentJob), the same
// cross-domain direct-table-read precedent used since Sprint 7's
// ApprovalService, most recently Sprint 16's SprintAcceptanceModule. It DOES
// import SprintAcceptanceModule one-directionally for the one reusable read
// it needs (getGateStatus, item 57/59/112) — exactly the same integration
// point Sprint 14's SprintExecutionModule already uses, so the dependency
// direction stays one-way: nothing imports ProjectDeliveryModule back.
@Module({
  imports: [
    ProjectsModule,
    ApprovalModule,
    WorkspaceModule,
    SprintAcceptanceModule,
  ],
  controllers: [ProjectDeliveryController],
  providers: [ProjectDeliveryService, ProjectDeliveryEvidenceBuilder],
  exports: [ProjectDeliveryService],
})
export class ProjectDeliveryModule {}
