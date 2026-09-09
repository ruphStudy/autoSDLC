import { CodingAgentExecutionJobHandler } from './coding-agent-execution.handler';
import { JobHandlerRegistry } from '../../jobs/job-handler.registry';
import { ApprovalService } from '../../approval/approval.service';
import { CodingAgentService } from '../coding-agent.service';
import {
  CodingAgentError,
  CodingAgentErrorCode,
} from '../errors/coding-agent.error';
import { JobExecutionContext } from '../../jobs/types/job.types';

function buildContext(
  overrides: Partial<JobExecutionContext<{ agentJobId: string }>> = {},
): JobExecutionContext<{ agentJobId: string }> {
  return {
    jobId: 'job-1',
    projectId: 'project-1',
    userId: 'user-1',
    attemptCount: 1,
    maxAttempts: 1,
    payload: { agentJobId: 'agent-job-1' },
    reportProgress: jest.fn().mockResolvedValue(undefined),
    isCancellationRequested: jest.fn().mockResolvedValue(false),
    heartbeat: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('CodingAgentExecutionJobHandler', () => {
  let registry: { register: jest.Mock };
  let approvalService: { assertDevelopmentApproved: jest.Mock };
  let codingAgentService: { execute: jest.Mock };
  let handler: CodingAgentExecutionJobHandler;

  beforeEach(() => {
    registry = { register: jest.fn() };
    approvalService = {
      assertDevelopmentApproved: jest.fn().mockResolvedValue(undefined),
    };
    codingAgentService = { execute: jest.fn() };
    handler = new CodingAgentExecutionJobHandler(
      registry as unknown as JobHandlerRegistry,
      approvalService as unknown as ApprovalService,
      codingAgentService as unknown as CodingAgentService,
    );
  });

  it('self-registers into the JobHandlerRegistry on module init', () => {
    handler.onModuleInit();
    expect(registry.register).toHaveBeenCalledWith(handler);
  });

  it('re-verifies development approval live before delegating to CodingAgentService', async () => {
    codingAgentService.execute.mockResolvedValue({
      id: 'agent-job-1',
      status: 'SUCCEEDED',
    });

    const outcome = await handler.execute(buildContext());

    expect(approvalService.assertDevelopmentApproved).toHaveBeenCalledWith(
      'project-1',
    );
    expect(codingAgentService.execute).toHaveBeenCalledWith(
      'agent-job-1',
      expect.anything(),
    );
    expect(outcome).toEqual({
      result: { id: 'agent-job-1', status: 'SUCCEEDED' },
    });
  });

  it('fails without calling CodingAgentService when approval is no longer valid', async () => {
    approvalService.assertDevelopmentApproved.mockRejectedValue(
      new Error('revoked'),
    );

    await expect(handler.execute(buildContext())).rejects.toMatchObject({
      code: 'coding_agent_execution_not_approved',
      retryable: false,
    });
    expect(codingAgentService.execute).not.toHaveBeenCalled();
  });

  it('fails when the job is missing a project or agentJobId', async () => {
    await expect(
      handler.execute(buildContext({ projectId: null })),
    ).rejects.toMatchObject({ code: 'coding_agent_execution_missing_context' });
    await expect(
      handler.execute(buildContext({ payload: {} as { agentJobId: string } })),
    ).rejects.toMatchObject({ code: 'coding_agent_execution_missing_context' });
    expect(approvalService.assertDevelopmentApproved).not.toHaveBeenCalled();
  });

  it('translates a CodingAgentError into a non-retryable JobExecutionError (item 44: never retry stateful coding execution)', async () => {
    codingAgentService.execute.mockRejectedValue(
      new CodingAgentError({
        code: CodingAgentErrorCode.TIMEOUT,
        message: 'timed out',
      }),
    );

    await expect(handler.execute(buildContext())).rejects.toMatchObject({
      code: CodingAgentErrorCode.TIMEOUT,
      retryable: false,
    });
  });

  it('propagates a non-CodingAgentError unchanged', async () => {
    codingAgentService.execute.mockRejectedValue(new Error('unexpected'));
    await expect(handler.execute(buildContext())).rejects.toThrow('unexpected');
  });
});
