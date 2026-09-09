import {
  TaskValidationJobHandler,
  TaskValidationJobPayload,
} from './task-validation.handler';
import { JobHandlerRegistry } from '../../jobs/job-handler.registry';
import { TaskValidationService } from '../task-validation.service';
import { JobExecutionContext } from '../../jobs/types/job.types';
import { JobExecutionError } from '../../jobs/errors/job.error';

function buildContext(
  overrides: Partial<JobExecutionContext<TaskValidationJobPayload>> = {},
): JobExecutionContext<TaskValidationJobPayload> {
  return {
    jobId: 'job-1',
    projectId: 'project-1',
    userId: 'user-1',
    attemptCount: 1,
    maxAttempts: 1,
    payload: {
      validationAttemptId: 'attempt-1',
      taskId: 'task-1',
      projectId: 'project-1',
    },
    reportProgress: jest.fn().mockResolvedValue(undefined),
    isCancellationRequested: jest.fn().mockResolvedValue(false),
    heartbeat: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('TaskValidationJobHandler', () => {
  let registry: { register: jest.Mock };
  let taskValidationService: { execute: jest.Mock };
  let handler: TaskValidationJobHandler;

  beforeEach(() => {
    registry = { register: jest.fn() };
    taskValidationService = { execute: jest.fn() };
    handler = new TaskValidationJobHandler(
      registry as unknown as JobHandlerRegistry,
      taskValidationService as unknown as TaskValidationService,
    );
  });

  it('self-registers into the JobHandlerRegistry on module init', () => {
    handler.onModuleInit();
    expect(registry.register).toHaveBeenCalledWith(handler);
  });

  it('delegates to TaskValidationService.execute with the validationAttemptId and the job context', async () => {
    const record = { id: 'attempt-1', status: 'PASSED' };
    taskValidationService.execute.mockResolvedValue(record);
    const context = buildContext();

    const outcome = await handler.execute(context);

    expect(taskValidationService.execute).toHaveBeenCalledWith(
      'attempt-1',
      context,
    );
    expect(outcome).toEqual({ result: record });
  });

  it('reports a FAILED result as a completed job outcome, not a job-level error (no automatic retry)', async () => {
    taskValidationService.execute.mockResolvedValue({
      id: 'attempt-1',
      status: 'FAILED',
    });

    const outcome = await handler.execute(buildContext());

    expect(outcome).toEqual({ result: { id: 'attempt-1', status: 'FAILED' } });
  });

  it('rejects with a non-retryable error when the payload is missing required ids', async () => {
    await expect(
      handler.execute(
        buildContext({
          payload: { validationAttemptId: '', taskId: '', projectId: '' },
        }),
      ),
    ).rejects.toBeInstanceOf(JobExecutionError);
    expect(taskValidationService.execute).not.toHaveBeenCalled();
  });
});
