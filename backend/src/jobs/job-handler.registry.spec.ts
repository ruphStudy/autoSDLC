import { JobType } from '@prisma/client';
import { JobHandlerRegistry } from './job-handler.registry';
import { JobHandler } from './types/job.types';

describe('JobHandlerRegistry', () => {
  it('resolves a registered handler by type', () => {
    const handler: JobHandler = {
      type: JobType.SYSTEM_TEST,
      execute: jest.fn(),
    };
    const registry = new JobHandlerRegistry([handler]);
    expect(registry.resolve(JobType.SYSTEM_TEST)).toBe(handler);
  });

  it('returns undefined for a type with no registered handler', () => {
    const registry = new JobHandlerRegistry([]);
    expect(registry.resolve(JobType.PROJECT_PREPARATION)).toBeUndefined();
  });

  it('accepts a handler registering itself after construction (self-registration)', () => {
    const registry = new JobHandlerRegistry([]);
    const handler: JobHandler = {
      type: JobType.WORKSPACE_PREPARE,
      execute: jest.fn(),
    };

    expect(registry.resolve(JobType.WORKSPACE_PREPARE)).toBeUndefined();
    registry.register(handler);
    expect(registry.resolve(JobType.WORKSPACE_PREPARE)).toBe(handler);
  });
});
