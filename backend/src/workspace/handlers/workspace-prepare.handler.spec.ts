import { WorkspacePrepareJobHandler } from './workspace-prepare.handler';
import { JobHandlerRegistry } from '../../jobs/job-handler.registry';
import { ApprovalService } from '../../approval/approval.service';
import { WorkspaceService } from '../workspace.service';
import { GitError, GitErrorCode } from '../errors/git.error';
import { JobExecutionContext } from '../../jobs/types/job.types';

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

describe('WorkspacePrepareJobHandler', () => {
  let registry: { register: jest.Mock; resolve: jest.Mock };
  let approvalService: { assertDevelopmentApproved: jest.Mock };
  let workspaceService: { markPreparing: jest.Mock; runPreparation: jest.Mock };
  let handler: WorkspacePrepareJobHandler;

  beforeEach(() => {
    registry = { register: jest.fn(), resolve: jest.fn() };
    approvalService = {
      assertDevelopmentApproved: jest.fn().mockResolvedValue(undefined),
    };
    workspaceService = {
      markPreparing: jest.fn().mockResolvedValue(undefined),
      runPreparation: jest.fn(),
    };
    handler = new WorkspacePrepareJobHandler(
      registry as unknown as JobHandlerRegistry,
      approvalService as unknown as ApprovalService,
      workspaceService as unknown as WorkspaceService,
    );
  });

  it('self-registers into the JobHandlerRegistry on module init', () => {
    handler.onModuleInit();
    expect(registry.register).toHaveBeenCalledWith(handler);
  });

  it('re-verifies development approval live before delegating to WorkspaceService', async () => {
    workspaceService.runPreparation.mockResolvedValue({ id: 'workspace-1' });

    const outcome = await handler.execute(buildContext());

    expect(approvalService.assertDevelopmentApproved).toHaveBeenCalledWith(
      'project-1',
    );
    expect(workspaceService.markPreparing).toHaveBeenCalledWith('project-1');
    expect(workspaceService.runPreparation).toHaveBeenCalledWith(
      'project-1',
      expect.anything(),
    );
    expect(outcome).toEqual({ result: { id: 'workspace-1' } });
  });

  it('fails without touching the workspace when approval is no longer valid', async () => {
    approvalService.assertDevelopmentApproved.mockRejectedValue(
      new Error('revoked'),
    );

    await expect(handler.execute(buildContext())).rejects.toMatchObject({
      code: 'workspace_prepare_not_approved',
      retryable: false,
    });
    expect(workspaceService.markPreparing).not.toHaveBeenCalled();
    expect(workspaceService.runPreparation).not.toHaveBeenCalled();
  });

  it('fails when the job has no project context', async () => {
    await expect(
      handler.execute(buildContext({ projectId: null })),
    ).rejects.toMatchObject({ code: 'workspace_prepare_missing_project' });
    expect(approvalService.assertDevelopmentApproved).not.toHaveBeenCalled();
  });

  it('translates a GitError from runPreparation into a JobExecutionError carrying its retryable flag', async () => {
    workspaceService.runPreparation.mockRejectedValue(
      new GitError({
        code: GitErrorCode.COMMAND_TIMEOUT,
        message: 'timed out',
        retryable: true,
      }),
    );

    await expect(handler.execute(buildContext())).rejects.toMatchObject({
      code: GitErrorCode.COMMAND_TIMEOUT,
      retryable: true,
    });
  });

  it('propagates a non-GitError from runPreparation unchanged', async () => {
    workspaceService.runPreparation.mockRejectedValue(new Error('unexpected'));

    await expect(handler.execute(buildContext())).rejects.toThrow('unexpected');
  });
});
