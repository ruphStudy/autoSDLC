import {
  SprintExecutionJobHandler,
  SprintExecutionJobPayload,
} from './sprint-execution.handler';
import { JobHandlerRegistry } from '../../jobs/job-handler.registry';
import { SprintExecutionService } from '../sprint-execution.service';
import { JobExecutionContext } from '../../jobs/types/job.types';
import { JobExecutionError } from '../../jobs/errors/job.error';

function buildContext(
  overrides: Partial<JobExecutionContext<SprintExecutionJobPayload>> = {},
): JobExecutionContext<SprintExecutionJobPayload> {
  return {
    jobId: 'job-1',
    projectId: 'project-1',
    userId: 'user-1',
    attemptCount: 1,
    maxAttempts: 1,
    payload: { sprintExecutionId: 'sprint-exec-1' },
    reportProgress: jest.fn().mockResolvedValue(undefined),
    isCancellationRequested: jest.fn().mockResolvedValue(false),
    heartbeat: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('SprintExecutionJobHandler', () => {
  let registry: { register: jest.Mock };
  let sprintExecutionService: { execute: jest.Mock };
  let handler: SprintExecutionJobHandler;

  beforeEach(() => {
    registry = { register: jest.fn() };
    sprintExecutionService = { execute: jest.fn() };
    handler = new SprintExecutionJobHandler(
      registry as unknown as JobHandlerRegistry,
      sprintExecutionService as unknown as SprintExecutionService,
    );
  });

  it('self-registers into the JobHandlerRegistry on module init', () => {
    handler.onModuleInit();
    expect(registry.register).toHaveBeenCalledWith(handler);
  });

  it('delegates to SprintExecutionService.execute with the sprintExecutionId and the job context', async () => {
    const record = { id: 'sprint-exec-1', status: 'COMPLETED' };
    sprintExecutionService.execute.mockResolvedValue(record);
    const context = buildContext();

    const outcome = await handler.execute(context);

    expect(sprintExecutionService.execute).toHaveBeenCalledWith(
      'sprint-exec-1',
      context,
    );
    expect(outcome).toEqual({ result: record });
  });

  it('reports a non-COMPLETED result as a completed job outcome, not a job-level error (no automatic retry)', async () => {
    sprintExecutionService.execute.mockResolvedValue({
      id: 'sprint-exec-1',
      status: 'FAILED',
    });

    const outcome = await handler.execute(buildContext());

    expect(outcome).toEqual({
      result: { id: 'sprint-exec-1', status: 'FAILED' },
    });
  });

  it('rejects with a non-retryable error when the payload is missing sprintExecutionId', async () => {
    await expect(
      handler.execute(buildContext({ payload: { sprintExecutionId: '' } })),
    ).rejects.toBeInstanceOf(JobExecutionError);
    expect(sprintExecutionService.execute).not.toHaveBeenCalled();
  });
});
