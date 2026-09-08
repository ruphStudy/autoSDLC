import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseEnumPipe,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JobStatus, JobType } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { SafeUser } from '../auth/types/auth.types';
import { JobService } from './job.service';
import { CreateJobDto } from './dto/create-job.dto';
import { JobEventRecord, JobRecord } from './types/job.types';

@UseGuards(JwtAuthGuard)
@Controller('projects/:projectId/jobs')
export class JobController {
  constructor(private readonly jobService: JobService) {}

  @Post()
  create(
    @CurrentUser() user: SafeUser,
    @Param('projectId') projectId: string,
    @Body() dto: CreateJobDto,
  ): Promise<JobRecord> {
    return this.jobService.enqueuePublic(user.id, projectId, dto.type);
  }

  @Get()
  list(
    @CurrentUser() user: SafeUser,
    @Param('projectId') projectId: string,
    @Query('status', new ParseEnumPipe(JobStatus, { optional: true }))
    status?: JobStatus,
    @Query('type', new ParseEnumPipe(JobType, { optional: true }))
    type?: JobType,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
  ): Promise<JobRecord[]> {
    return this.jobService.list(user.id, projectId, { status, type, limit });
  }

  @Get(':jobId')
  detail(
    @CurrentUser() user: SafeUser,
    @Param('projectId') projectId: string,
    @Param('jobId') jobId: string,
  ): Promise<JobRecord> {
    return this.jobService.getById(user.id, projectId, jobId);
  }

  @Get(':jobId/events')
  events(
    @CurrentUser() user: SafeUser,
    @Param('projectId') projectId: string,
    @Param('jobId') jobId: string,
  ): Promise<JobEventRecord[]> {
    return this.jobService.getEvents(user.id, projectId, jobId);
  }

  @Post(':jobId/cancel')
  @HttpCode(HttpStatus.OK)
  cancel(
    @CurrentUser() user: SafeUser,
    @Param('projectId') projectId: string,
    @Param('jobId') jobId: string,
  ): Promise<JobRecord> {
    return this.jobService.cancel(user.id, projectId, jobId);
  }
}
