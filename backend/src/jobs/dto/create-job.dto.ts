import { IsIn } from 'class-validator';
import { JobType } from '@prisma/client';
import { PUBLICLY_ENQUEUABLE_JOB_TYPES } from '../jobs.constants';

// Deliberately whitelists only publicly-enqueueable types and accepts no
// payload from the client at all — the service builds whatever payload each
// type needs internally (see JobController.create / JobService.enqueuePublic).
export class CreateJobDto {
  @IsIn(PUBLICLY_ENQUEUABLE_JOB_TYPES)
  type!: JobType;
}
