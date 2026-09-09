import { JobStatus, JobType } from '@prisma/client';
import {
  isValidJobTransition,
  JOB_TYPE_REQUIRES_DEVELOPMENT_APPROVAL,
} from './jobs.constants';

describe('isValidJobTransition', () => {
  it('allows QUEUED -> RUNNING and QUEUED -> CANCELLED', () => {
    expect(isValidJobTransition(JobStatus.QUEUED, JobStatus.RUNNING)).toBe(
      true,
    );
    expect(isValidJobTransition(JobStatus.QUEUED, JobStatus.CANCELLED)).toBe(
      true,
    );
  });

  it('rejects QUEUED -> SUCCEEDED (must run first)', () => {
    expect(isValidJobTransition(JobStatus.QUEUED, JobStatus.SUCCEEDED)).toBe(
      false,
    );
  });

  it('allows RUNNING -> SUCCEEDED / FAILED / RETRY_WAIT / CANCELLED', () => {
    expect(isValidJobTransition(JobStatus.RUNNING, JobStatus.SUCCEEDED)).toBe(
      true,
    );
    expect(isValidJobTransition(JobStatus.RUNNING, JobStatus.FAILED)).toBe(
      true,
    );
    expect(isValidJobTransition(JobStatus.RUNNING, JobStatus.RETRY_WAIT)).toBe(
      true,
    );
    expect(isValidJobTransition(JobStatus.RUNNING, JobStatus.CANCELLED)).toBe(
      true,
    );
  });

  it('allows RETRY_WAIT -> RUNNING and RETRY_WAIT -> CANCELLED', () => {
    expect(isValidJobTransition(JobStatus.RETRY_WAIT, JobStatus.RUNNING)).toBe(
      true,
    );
    expect(
      isValidJobTransition(JobStatus.RETRY_WAIT, JobStatus.CANCELLED),
    ).toBe(true);
  });

  it('never allows a transition out of a terminal state', () => {
    for (const to of Object.values(JobStatus)) {
      expect(isValidJobTransition(JobStatus.SUCCEEDED, to)).toBe(false);
      expect(isValidJobTransition(JobStatus.FAILED, to)).toBe(false);
      expect(isValidJobTransition(JobStatus.CANCELLED, to)).toBe(false);
    }
  });
});

describe('JOB_TYPE_REQUIRES_DEVELOPMENT_APPROVAL', () => {
  it('requires development approval for WORKSPACE_PREPARE, same as PROJECT_PREPARATION', () => {
    expect(
      JOB_TYPE_REQUIRES_DEVELOPMENT_APPROVAL[JobType.WORKSPACE_PREPARE],
    ).toBe(true);
    expect(
      JOB_TYPE_REQUIRES_DEVELOPMENT_APPROVAL[JobType.PROJECT_PREPARATION],
    ).toBe(true);
  });

  it('requires development approval for CODING_AGENT_EXECUTION', () => {
    expect(
      JOB_TYPE_REQUIRES_DEVELOPMENT_APPROVAL[JobType.CODING_AGENT_EXECUTION],
    ).toBe(true);
  });

  it('exempts SYSTEM_TEST as pure infrastructure validation', () => {
    expect(JOB_TYPE_REQUIRES_DEVELOPMENT_APPROVAL[JobType.SYSTEM_TEST]).toBe(
      false,
    );
  });
});
