import { TaskInstructionContentSchema } from './task-instruction-content.schema';

function validContent(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    objective: 'Implement the User model and repository.',
    repositoryObservations: ['The backend uses NestJS with Prisma.'],
    implementationPlan: [
      {
        step: 1,
        description: 'Add the User model to schema.prisma.',
        likelyFiles: ['prisma/schema.prisma'],
      },
      { step: 2, description: 'Create UsersService with a create method.' },
    ],
    constraints: ['Do not modify unrelated modules.'],
    acceptanceCriteria: ['A user can be created.', 'Email must be unique.'],
    validationPlan: [
      { type: 'unit_test', description: 'Unit tests pass.', required: true },
    ],
    dependencyContext: [
      { taskKey: 'S1-T0', summary: 'Project scaffolding is complete.' },
    ],
    risksOrWatchouts: ['Ensure password hashing is used.'],
    requirementIds: ['FR-001'],
    finalInstruction: 'TASK\nImplement the User model...\n',
    ...overrides,
  };
}

describe('TaskInstructionContentSchema', () => {
  it('accepts a valid instruction', () => {
    const result = TaskInstructionContentSchema.safeParse(validContent());
    expect(result.success).toBe(true);
  });

  it('rejects a missing objective', () => {
    const content = validContent();
    delete (content as Record<string, unknown>).objective;
    expect(TaskInstructionContentSchema.safeParse(content).success).toBe(false);
  });

  it('rejects an empty implementation plan', () => {
    const result = TaskInstructionContentSchema.safeParse(
      validContent({ implementationPlan: [] }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects an empty finalInstruction', () => {
    const result = TaskInstructionContentSchema.safeParse(
      validContent({ finalInstruction: '' }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects an empty acceptanceCriteria array', () => {
    const result = TaskInstructionContentSchema.safeParse(
      validContent({ acceptanceCriteria: [] }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects an empty validationPlan array', () => {
    const result = TaskInstructionContentSchema.safeParse(
      validContent({ validationPlan: [] }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects a finalInstruction beyond the static safety ceiling', () => {
    const result = TaskInstructionContentSchema.safeParse(
      validContent({ finalInstruction: 'x'.repeat(100001) }),
    );
    expect(result.success).toBe(false);
  });

  it('defaults optional arrays to empty when omitted', () => {
    const content = validContent() as Record<string, unknown>;
    delete content.risksOrWatchouts;
    delete content.constraints;
    const result = TaskInstructionContentSchema.parse(content);
    expect(result.risksOrWatchouts).toEqual([]);
    expect(result.constraints).toEqual([]);
  });

  it('rejects an implementation step missing a description', () => {
    const result = TaskInstructionContentSchema.safeParse(
      validContent({ implementationPlan: [{ step: 1 }] }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects a validation-plan entry missing required', () => {
    const result = TaskInstructionContentSchema.safeParse(
      validContent({
        validationPlan: [{ type: 'unit_test', description: 'x' }],
      }),
    );
    expect(result.success).toBe(false);
  });
});
