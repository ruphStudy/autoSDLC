import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { ProjectsModule } from './projects/projects.module';
import { PlanningAIModule } from './ai/planning/planning-ai.module';
import { ProjectAnalysisModule } from './project-analysis/project-analysis.module';
import { ArchitectureModule } from './architecture/architecture.module';
import { SprintPlanningModule } from './sprint-planning/sprint-planning.module';
import { ApprovalModule } from './approval/approval.module';
import { JobsModule } from './jobs/jobs.module';
import { WorkspaceModule } from './workspace/workspace.module';
import { envValidationSchema } from './config/env.validation';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: envValidationSchema,
    }),
    PrismaModule,
    AuthModule,
    ProjectsModule,
    PlanningAIModule,
    ProjectAnalysisModule,
    ArchitectureModule,
    SprintPlanningModule,
    ApprovalModule,
    JobsModule,
    WorkspaceModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
