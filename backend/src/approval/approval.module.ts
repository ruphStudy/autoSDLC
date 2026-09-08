import { Module } from '@nestjs/common';
import { ProjectsModule } from '../projects/projects.module';
import { ApprovalController } from './approval.controller';
import { ApprovalService } from './approval.service';

@Module({
  imports: [ProjectsModule],
  controllers: [ApprovalController],
  providers: [ApprovalService],
  exports: [ApprovalService],
})
export class ApprovalModule {}
