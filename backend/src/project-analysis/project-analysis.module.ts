import { Module } from '@nestjs/common';
import { ProjectsModule } from '../projects/projects.module';
import { PlanningAIModule } from '../ai/planning/planning-ai.module';
import { ProjectAnalysisController } from './project-analysis.controller';
import { ProjectAnalysisService } from './project-analysis.service';

@Module({
  imports: [ProjectsModule, PlanningAIModule],
  controllers: [ProjectAnalysisController],
  providers: [ProjectAnalysisService],
})
export class ProjectAnalysisModule {}
