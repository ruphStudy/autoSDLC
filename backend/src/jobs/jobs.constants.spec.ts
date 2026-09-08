import { JobStatus } from '@prisma/client';
import { isValidJobTransition } from './jobs.constants';

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
