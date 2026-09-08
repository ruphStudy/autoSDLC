import { Module } from '@nestjs/common';
import { ProjectsModule } from '../projects/projects.module';
import { PlanningAIModule } from '../ai/planning/planning-ai.module';
import { ApprovalModule } from '../approval/approval.module';
import { ArchitectureController } from './architecture.controller';
import { ArchitectureService } from './architecture.service';

@Module({
  imports: [ProjectsModule, PlanningAIModule, ApprovalModule],
  controllers: [ArchitectureController],
  providers: [ArchitectureService],
})
export class ArchitectureModule {}
