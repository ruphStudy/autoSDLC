import { Injectable } from '@nestjs/common';
import { JobType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ApprovalService } from '../../approval/approval.service';
import { JobExecutionError } from '../errors/job.error';
import {
  JobExecutionContext,
  JobHandler,
  JobHandlerResult,
} from '../types/job.types';

export type ProjectPreparationJobPayload = Record<string, never>;

export interface ProjectPreparationJobResult {
  projectId: string;
  projectName: string;
  analysisVersion: number | null;
  architectureVersion: number | null;
  sprintPlanVersion: number | null;
  sprintCount: number;
  taskCount: number;
}

// Proves the Sprint 7 approval gate integrates correctly with the job
// system — it does nothing beyond reading and summarizing already-approved
// planning state. No repo clone, no workspace, no commands, no AI calls.
@Injectable()
export class ProjectPreparationJobHandler implements JobHandler<
  ProjectPreparationJobPayload,
  ProjectPreparationJobResult
> {
  readonly type = JobType.PROJECT_PREPARATION;

  constructor(
    private readonly prisma: PrismaService,
    private readonly approvalService: ApprovalService,
  ) {}

  async execute(
    context: JobExecutionContext<ProjectPreparationJobPayload>,
  ): Promise<JobHandlerResult<ProjectPreparationJobResult>> {
    const projectId = context.projectId;
    if (!projectId) {
      throw new JobExecutionError(
        'project_preparation_missing_project',
        'PROJECT_PREPARATION requires a project.',
        false,
      );
    }

    await context.reportProgress(10, 'Verifying development approval...');
    // Defense in depth: JobService.enqueue already asserted this at enqueue
    // time, but approval state could have changed while this job sat in the
    // queue — the handler must never trust a decision made in the past.
    try {
      await this.approvalService.assertDevelopmentApproved(projectId);
    } catch {
      throw new JobExecutionError(
        'project_preparation_not_approved',
        'Development approval is no longer valid for this project.',
        false,
      );
    }

    await context.reportProgress(50, 'Gathering project summary...');
    const [project, analysis, architecture, sprintPlan] = await Promise.all([
      this.prisma.project.findUnique({
        where: { id: projectId },
        select: { id: true, name: true },
      }),
      this.prisma.projectAnalysis.findFirst({
        where: { projectId },
        orderBy: { version: 'desc' },
        select: { version: true },
      }),
      this.prisma.architecture.findFirst({
        where: { projectId },
        orderBy: { version: 'desc' },
        select: { version: true },
      }),
      this.prisma.sprintPlan.findFirst({
        where: { projectId },
        orderBy: { version: 'desc' },
        select: { id: true, version: true },
      }),
    ]);

    if (!project) {
      throw new JobExecutionError(
        'project_preparation_project_missing',
        'Project no longer exists.',
        false,
      );
    }

    const [sprintCount, taskCount] = sprintPlan
      ? await Promise.all([
          this.prisma.sprint.count({ where: { sprintPlanId: sprintPlan.id } }),
          this.prisma.task.count({ where: { sprintPlanId: sprintPlan.id } }),
        ])
      : [0, 0];

    await context.reportProgress(100, 'Preparation summary ready.');

    return {
      result: {
        projectId: project.id,
        projectName: project.name,
        analysisVersion: analysis?.version ?? null,
        architectureVersion: architecture?.version ?? null,
        sprintPlanVersion: sprintPlan?.version ?? null,
        sprintCount,
        taskCount,
      },
    };
  }
}
