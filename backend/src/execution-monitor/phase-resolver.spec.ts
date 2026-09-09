import { resolveExecutionPhase } from './phase-resolver';

describe('resolveExecutionPhase', () => {
  it('resolves IDLE when no SprintExecution has ever been created', () => {
    expect(resolveExecutionPhase({ sprintExecutionStatus: null })).toBe('IDLE');
  });

  it('resolves QUEUED when the Sprint job has not been picked up yet', () => {
    expect(resolveExecutionPhase({ sprintExecutionStatus: 'QUEUED' })).toBe(
      'QUEUED',
    );
  });

  it('resolves PREPARING when RUNNING but no Task has been claimed yet', () => {
    expect(
      resolveExecutionPhase({
        sprintExecutionStatus: 'RUNNING',
        taskExecution: null,
      }),
    ).toBe('PREPARING');
  });

  it('resolves PREPARING when the TaskExecution is still QUEUED', () => {
    expect(
      resolveExecutionPhase({
        sprintExecutionStatus: 'RUNNING',
        taskExecution: { status: 'QUEUED', agentJobId: null },
      }),
    ).toBe('PREPARING');
  });

  it('resolves GENERATING_INSTRUCTION when RUNNING with no AgentJob yet', () => {
    expect(
      resolveExecutionPhase({
        sprintExecutionStatus: 'RUNNING',
        taskExecution: { status: 'RUNNING', agentJobId: null },
      }),
    ).toBe('GENERATING_INSTRUCTION');
  });

  it('resolves CODING when the AgentJob is QUEUED or RUNNING', () => {
    expect(
      resolveExecutionPhase({
        sprintExecutionStatus: 'RUNNING',
        taskExecution: { status: 'RUNNING', agentJobId: 'agent-1' },
        agentJob: { status: 'RUNNING' },
      }),
    ).toBe('CODING');
    expect(
      resolveExecutionPhase({
        sprintExecutionStatus: 'RUNNING',
        taskExecution: { status: 'RUNNING', agentJobId: 'agent-1' },
        agentJob: { status: 'QUEUED' },
      }),
    ).toBe('CODING');
  });

  it('resolves CAPTURING_CHANGES once the agent finishes but the Task has not flipped yet', () => {
    expect(
      resolveExecutionPhase({
        sprintExecutionStatus: 'RUNNING',
        taskExecution: { status: 'RUNNING', agentJobId: 'agent-1' },
        agentJob: { status: 'SUCCEEDED' },
      }),
    ).toBe('CAPTURING_CHANGES');
  });

  it('resolves CAPTURING_CHANGES when TaskExecution reaches AGENT_COMPLETED', () => {
    expect(
      resolveExecutionPhase({
        sprintExecutionStatus: 'RUNNING',
        taskExecution: { status: 'AGENT_COMPLETED', agentJobId: 'agent-1' },
      }),
    ).toBe('CAPTURING_CHANGES');
  });

  it('resolves VALIDATING when the Task is REVIEWING and a check is still running', () => {
    expect(
      resolveExecutionPhase({
        sprintExecutionStatus: 'RUNNING',
        taskExecution: {
          status: 'READY_FOR_VALIDATION',
          agentJobId: 'agent-1',
        },
        validationAttempt: {
          status: 'RUNNING',
          runs: [{ status: 'PASSED' }, { status: 'RUNNING' }],
        },
      }),
    ).toBe('VALIDATING');
  });

  it('resolves COMMITTING when every check has finished but the attempt is still RUNNING', () => {
    expect(
      resolveExecutionPhase({
        sprintExecutionStatus: 'RUNNING',
        taskExecution: {
          status: 'READY_FOR_VALIDATION',
          agentJobId: 'agent-1',
        },
        validationAttempt: {
          status: 'RUNNING',
          runs: [{ status: 'PASSED' }, { status: 'PASSED' }],
        },
      }),
    ).toBe('COMMITTING');
  });

  it('resolves PREPARING when REVIEWING but validation has not started yet', () => {
    expect(
      resolveExecutionPhase({
        sprintExecutionStatus: 'RUNNING',
        taskExecution: {
          status: 'READY_FOR_VALIDATION',
          agentJobId: 'agent-1',
        },
        validationAttempt: null,
      }),
    ).toBe('PREPARING');
  });

  it('resolves PAUSED regardless of stale subordinate Task/Agent state', () => {
    expect(
      resolveExecutionPhase({
        sprintExecutionStatus: 'PAUSED',
        taskExecution: { status: 'RUNNING', agentJobId: 'agent-1' },
        agentJob: { status: 'RUNNING' },
      }),
    ).toBe('PAUSED');
  });

  it('resolves BLOCKED for a BLOCKED SprintExecution', () => {
    expect(resolveExecutionPhase({ sprintExecutionStatus: 'BLOCKED' })).toBe(
      'BLOCKED',
    );
  });

  it('resolves FAILED regardless of stale subordinate PENDING-looking state', () => {
    expect(
      resolveExecutionPhase({
        sprintExecutionStatus: 'FAILED',
        taskExecution: { status: 'QUEUED', agentJobId: null },
      }),
    ).toBe('FAILED');
  });

  it('resolves COMPLETED for a COMPLETED SprintExecution', () => {
    expect(resolveExecutionPhase({ sprintExecutionStatus: 'COMPLETED' })).toBe(
      'COMPLETED',
    );
  });

  it('resolves CANCELLED for a CANCELLED SprintExecution', () => {
    expect(resolveExecutionPhase({ sprintExecutionStatus: 'CANCELLED' })).toBe(
      'CANCELLED',
    );
  });
});
