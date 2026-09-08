import { ProjectPreparationJobHandler } from './project-preparation.handler';
import { PrismaService } from '../../prisma/prisma.service';
import { ApprovalService } from '../../approval/approval.service';
import { JobExecutionError } from '../errors/job.error';
import { JobExecutionContext } from '../types/job.types';

function buildContext(
  overrides: Partial<JobExecutionContext<Record<string, never>>> = {},
): JobExecutionContext<Record<string, never>> {
  return {
    jobId: 'job-1',
    projectId: 'project-1',
    userId: 'user-1',
    attemptCount: 1,
    maxAttempts: 3,
    payload: {},
    reportProgress: jest.fn().mockResolvedValue(undefined),
    isCancellationRequested: jest.fn().mockResolvedValue(false),
    heartbeat: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('ProjectPreparationJobHandler', () => {
  let prisma: {
    project: { findUnique: jest.Mock };
    projectAnalysis: { findFirst: jest.Mock };
    architecture: { findFirst: jest.Mock };
    sprintPlan: { findFirst: jest.Mock };
    sprint: { count: jest.Mock };
    task: { count: jest.Mock };
  };
  let approvalService: { assertDevelopmentApproved: jest.Mock };
  let handler: ProjectPreparationJobHandler;

  beforeEach(() => {
    prisma = {
      project: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'project-1', name: 'Demo' }),
      },
      projectAnalysis: {
        findFirst: jest.fn().mockResolvedValue({ version: 2 }),
      },
      architecture: { findFirst: jest.fn().mockResolvedValue({ version: 1 }) },
      sprintPlan: {
        findFirst: jest.fn().mockResolvedValue({ id: 'plan-1', version: 3 }),
      },
      sprint: { count: jest.fn().mockResolvedValue(4) },
      task: { count: jest.fn().mockResolvedValue(12) },
    };
    approvalService = {
      assertDevelopmentApproved: jest.fn().mockResolvedValue(undefined),
    };
    handler = new ProjectPreparationJobHandler(
      prisma as unknown as PrismaService,
      approvalService as unknown as ApprovalService,
    );
  });

  it('returns a summary of the current planning artifacts', async () => {
    const outcome = await handler.execute(buildContext());

    expect(outcome).toEqual({
      result: {
        projectId: 'project-1',
        projectName: 'Demo',
        analysisVersion: 2,
        architectureVersion: 1,
        sprintPlanVersion: 3,
        sprintCount: 4,
        taskCount: 12,
      },
    });
    expect(approvalService.assertDevelopmentApproved).toHaveBeenCalledWith(
      'project-1',
    );
  });

  it('re-verifies development approval live rather than trusting enqueue-time state', async () => {
    approvalService.assertDevelopmentApproved.mockRejectedValue(
      new Error('no longer approved'),
    );
    await expect(handler.execute(buildContext())).rejects.toMatchObject({
      code: 'project_preparation_not_approved',
      retryable: false,
    });
  });

  it('fails when the job has no project context', async () => {
    await expect(
      handler.execute(buildContext({ projectId: null })),
    ).rejects.toMatchObject({
      code: 'project_preparation_missing_project',
    });
    expect(approvalService.assertDevelopmentApproved).not.toHaveBeenCalled();
  });

  it('fails when the project no longer exists', async () => {
    prisma.project.findUnique.mockResolvedValue(null);
    await expect(handler.execute(buildContext())).rejects.toBeInstanceOf(
      JobExecutionError,
    );
  });

  it('reports zero sprint/task counts when no sprint plan exists yet', async () => {
    prisma.sprintPlan.findFirst.mockResolvedValue(null);
    const outcome = await handler.execute(buildContext());
    expect(outcome).toMatchObject({
      result: { sprintPlanVersion: null, sprintCount: 0, taskCount: 0 },
    });
    expect(prisma.sprint.count).not.toHaveBeenCalled();
  });
});
