import { Module } from '@nestjs/common';
import { ProjectsModule } from '../projects/projects.module';
import { ApprovalModule } from '../approval/approval.module';
import { JobController } from './job.controller';
import { JobService } from './job.service';
import { JobWorkerService } from './job-worker.service';
import { JobHandlerRegistry } from './job-handler.registry';
import { JobsConfigService } from './jobs.config';
import { JOB_HANDLERS } from './jobs.constants';
import { SystemTestJobHandler } from './handlers/system-test.handler';
import { ProjectPreparationJobHandler } from './handlers/project-preparation.handler';

@Module({
  imports: [ProjectsModule, ApprovalModule],
  controllers: [JobController],
  providers: [
    JobService,
    JobWorkerService,
    JobHandlerRegistry,
    JobsConfigService,
    SystemTestJobHandler,
    ProjectPreparationJobHandler,
    {
      provide: JOB_HANDLERS,
      useFactory: (
        systemTest: SystemTestJobHandler,
        projectPreparation: ProjectPreparationJobHandler,
      ) => [systemTest, projectPreparation],
      inject: [SystemTestJobHandler, ProjectPreparationJobHandler],
    },
  ],
  exports: [JobService, JobWorkerService],
})
export class JobsModule {}
