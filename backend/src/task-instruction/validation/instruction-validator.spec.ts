import { validateInstructionContent } from './instruction-validator';
import { TaskInstructionContent } from '../schemas/task-instruction-content.schema';
import { TaskContext } from '../contracts/task-context.types';

function buildContent(
  overrides: Partial<TaskInstructionContent> = {},
): TaskInstructionContent {
  return {
    objective: 'Implement the User model.',
    repositoryObservations: [],
    implementationPlan: [
      {
        step: 1,
        description: 'Add model.',
        likelyFiles: ['prisma/schema.prisma'],
      },
    ],
    constraints: [],
    acceptanceCriteria: ['A user can be created.', 'Email must be unique.'],
    validationPlan: [
      { type: 'unit_test', description: 'Unit tests pass.', required: true },
    ],
    dependencyContext: [{ taskKey: 'S1-T0', summary: 'Scaffolding complete.' }],
    risksOrWatchouts: [],
    requirementIds: ['FR-001'],
    finalInstruction: 'TASK\n...',
    ...overrides,
  };
}

function buildTask(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    acceptanceCriteria: ['A user can be created.', 'Email must be unique.'],
    validationExpectations: [
      { type: 'unit_test', description: 'Unit tests pass.', required: true },
    ],
    requirementIds: ['FR-001'],
    ...overrides,
  };
}

function buildContext(): TaskContext {
  return {
    dependencies: [{ taskKey: 'S1-T0', title: 'Setup', status: 'PASSED' }],
  } as TaskContext;
}

const WORKSPACE = '/workspaces/project-1';

describe('validateInstructionContent', () => {
  it('passes for a fully compliant instruction', () => {
    const failures = validateInstructionContent(
      buildContent(),
      buildTask(),
      buildContext(),
      WORKSPACE,
    );
    expect(failures).toEqual([]);
  });

  it('flags a missing acceptance criterion', () => {
    const content = buildContent({
      acceptanceCriteria: ['A user can be created.'],
    });
    const failures = validateInstructionContent(
      content,
      buildTask(),
      buildContext(),
      WORKSPACE,
    );
    expect(
      failures.some((f) => f.reason.includes('Email must be unique')),
    ).toBe(true);
  });

  it('accepts an acceptance criterion that only differs by whitespace/case (normalized equality)', () => {
    const content = buildContent({
      acceptanceCriteria: [
        '  a user CAN be   created.  ',
        'email must be unique.',
      ],
    });
    const failures = validateInstructionContent(
      content,
      buildTask(),
      buildContext(),
      WORKSPACE,
    );
    expect(failures).toEqual([]);
  });

  it('flags a missing required validation expectation', () => {
    const content = buildContent({
      validationPlan: [
        { type: 'lint', description: 'Lint passes.', required: false },
      ],
    });
    const failures = validateInstructionContent(
      content,
      buildTask(),
      buildContext(),
      WORKSPACE,
    );
    expect(failures.some((f) => f.reason.includes('Unit tests pass'))).toBe(
      true,
    );
  });

  it('allows extra non-required validation-plan entries beyond the required ones', () => {
    const content = buildContent({
      validationPlan: [
        { type: 'unit_test', description: 'Unit tests pass.', required: true },
        { type: 'lint', description: 'Lint passes.', required: false },
      ],
    });
    const failures = validateInstructionContent(
      content,
      buildTask(),
      buildContext(),
      WORKSPACE,
    );
    expect(failures).toEqual([]);
  });

  it('flags an invented requirement id not on the Task', () => {
    const content = buildContent({ requirementIds: ['FR-001', 'FR-999'] });
    const failures = validateInstructionContent(
      content,
      buildTask(),
      buildContext(),
      WORKSPACE,
    );
    expect(failures.some((f) => f.reason.includes('FR-999'))).toBe(true);
  });

  it('flags an invented dependency Task key', () => {
    const content = buildContent({
      dependencyContext: [{ taskKey: 'S9-T9', summary: 'made up' }],
    });
    const failures = validateInstructionContent(
      content,
      buildTask(),
      buildContext(),
      WORKSPACE,
    );
    expect(failures.some((f) => f.reason.includes('S9-T9'))).toBe(true);
  });

  it('flags an unsafe absolute likelyFiles path', () => {
    const content = buildContent({
      implementationPlan: [
        { step: 1, description: 'x', likelyFiles: ['/etc/passwd'] },
      ],
    });
    const failures = validateInstructionContent(
      content,
      buildTask(),
      buildContext(),
      WORKSPACE,
    );
    expect(failures.some((f) => f.reason.includes('/etc/passwd'))).toBe(true);
  });

  it('flags a likelyFiles path that traverses out of the workspace', () => {
    const content = buildContent({
      implementationPlan: [
        {
          step: 1,
          description: 'x',
          likelyFiles: ['../other-project/secret.env'],
        },
      ],
    });
    const failures = validateInstructionContent(
      content,
      buildTask(),
      buildContext(),
      WORKSPACE,
    );
    expect(failures.some((f) => f.reason.includes('other-project'))).toBe(true);
  });

  it('allows a likelyFiles path that does not yet exist, as long as it is workspace-relative', () => {
    const content = buildContent({
      implementationPlan: [
        {
          step: 1,
          description: 'x',
          likelyFiles: ['src/new-file-not-created-yet.ts'],
        },
      ],
    });
    const failures = validateInstructionContent(
      content,
      buildTask(),
      buildContext(),
      WORKSPACE,
    );
    expect(failures).toEqual([]);
  });
});
