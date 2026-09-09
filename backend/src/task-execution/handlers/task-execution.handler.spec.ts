import { TaskExecutionJobHandler } from './task-execution.handler';
import { JobHandlerRegistry } from '../../jobs/job-handler.registry';
import { TaskExecutionService } from '../task-execution.service';
import { JobExecutionContext } from '../../jobs/types/job.types';
import { TaskExecutionJobPayload } from './task-execution.handler';
import { JobExecutionError } from '../../jobs/errors/job.error';

function buildContext(
  overrides: Partial<JobExecutionContext<TaskExecutionJobPayload>> = {},
): JobExecutionContext<TaskExecutionJobPayload> {
  return {
    jobId: 'job-1',
    projectId: 'project-1',
    userId: 'user-1',
    attemptCount: 1,
    maxAttempts: 1,
    payload: { taskExecutionId: 'exec-1', taskId: 'task-1', projectId: 'project-1' },
    reportProgress: jest.fn().mockResolvedValue(undefined),
    isCancellationRequested: jest.fn().mockResolvedValue(false),
    heartbeat: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('TaskExecutionJobHandler', () => {
  let registry: { register: jest.Mock };
  let taskExecutionService: { execute: jest.Mock };
  let handler: TaskExecutionJobHandler;

  beforeEach(() => {
    registry = { register: jest.fn() };
    taskExecutionService = { execute: jest.fn() };
    handler = new TaskExecutionJobHandler(
      registry as unknown as JobHandlerRegistry,
      taskExecutionService as unknown as TaskExecutionService,
    );
  });

  it('self-registers into the JobHandlerRegistry on module init', () => {
    handler.onModuleInit();
    expect(registry.register).toHaveBeenCalledWith(handler);
  });

  it('delegates to TaskExecutionService.execute with the taskExecutionId and the job context', async () => {
    const record = { id: 'exec-1', status: 'READY_FOR_VALIDATION' };
    taskExecutionService.execute.mockResolvedValue(record);
    const context = buildContext();

    const outcome = await handler.execute(context);

    expect(taskExecutionService.execute).toHaveBeenCalledWith('exec-1', context);
    expect(outcome).toEqual({ result: record });
  });

  it('reports a FAILED result as a completed job outcome, not a job-level error (no automatic retry)', async () => {
    taskExecutionService.execute.mockResolvedValue({ id: 'exec-1', status: 'FAILED' });

    const outcome = await handler.execute(buildContext());

    expect(outcome).toEqual({ result: { id: 'exec-1', status: 'FAILED' } });
  });

  it('rejects with a non-retryable error when the payload is missing required ids', async () => {
    await expect(
      handler.execute(buildContext({ payload: { taskExecutionId: '', taskId: '', projectId: '' } })),
    ).rejects.toBeInstanceOf(JobExecutionError);
    expect(taskExecutionService.execute).not.toHaveBeenCalled();
  });
});
