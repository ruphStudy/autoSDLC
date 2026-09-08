import { Module } from '@nestjs/common';
import { ProjectsModule } from '../projects/projects.module';
import { PlanningAIModule } from '../ai/planning/planning-ai.module';
import { ApprovalModule } from '../approval/approval.module';
import { SprintPlanningController } from './sprint-planning.controller';
import { SprintPlanningService } from './sprint-planning.service';

@Module({
  imports: [ProjectsModule, PlanningAIModule, ApprovalModule],
  controllers: [SprintPlanningController],
  providers: [SprintPlanningService],
})
export class SprintPlanningModule {}
