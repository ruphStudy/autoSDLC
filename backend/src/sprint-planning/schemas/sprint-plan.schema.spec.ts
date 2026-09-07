import { SprintPlanContentSchema } from './sprint-plan.schema';

function validPlan() {
  return {
    summary: 'Deliver the mock interview platform MVP in two increments.',
    strategy:
      'Build the foundation first, then layer the interview feature on top.',
    sprints: [
      {
        number: 1,
        title: 'Foundation',
        objective: 'Stand up the application foundation and authentication.',
        dependencies: [],
        tasks: [
          {
            key: 'S1-T1',
            title: 'Set up project foundation',
            description: 'Initialize the backend and frontend scaffolding.',
            dependencies: [],
            acceptanceCriteria: ['Backend and frontend build successfully.'],
            validationExpectations: [
              {
                type: 'build',
                description: 'Backend and frontend build.',
                required: true,
              },
            ],
            requirementIds: [],
            architectureAreas: ['backendArchitecture'],
          },
          {
            key: 'S1-T2',
            title: 'Implement authentication',
            description: 'Registration and login with JWT.',
            dependencies: ['S1-T1'],
            acceptanceCriteria: ['A user can register.', 'A user can log in.'],
            validationExpectations: [
              {
                type: 'unit_test',
                description: 'Auth service unit tests.',
                required: true,
              },
            ],
            requirementIds: ['FR-001'],
            architectureAreas: ['authenticationArchitecture'],
          },
        ],
      },
      {
        number: 2,
        title: 'Mock Interviews',
        objective: 'Let users run a mock interview session.',
        dependencies: [1],
        tasks: [
          {
            key: 'S2-T1',
            title: 'Implement mock interview sessions',
            description: 'Start and complete a mock interview session.',
            dependencies: ['S1-T2'],
            acceptanceCriteria: ['A user can start a mock interview session.'],
            validationExpectations: [
              {
                type: 'e2e_test',
                description: 'API e2e flow for sessions.',
                required: true,
              },
            ],
            requirementIds: ['FR-002'],
            architectureAreas: ['backendArchitecture'],
          },
        ],
      },
    ],
  };
}

describe('SprintPlanContentSchema', () => {
  it('accepts a fully valid plan', () => {
    const result = SprintPlanContentSchema.safeParse(validPlan());
    expect(result.success).toBe(true);
  });

  it('rejects a missing sprint title', () => {
    const plan = validPlan();
    delete (plan.sprints[0] as Record<string, unknown>).title;
    expect(SprintPlanContentSchema.safeParse(plan).success).toBe(false);
  });

  it('rejects duplicate sprint numbers', () => {
    const plan = validPlan();
    plan.sprints[1].number = 1;
    expect(SprintPlanContentSchema.safeParse(plan).success).toBe(false);
  });

  it('rejects non-contiguous sprint numbering', () => {
    const plan = validPlan();
    plan.sprints[1].number = 3;
    expect(SprintPlanContentSchema.safeParse(plan).success).toBe(false);
  });

  it('rejects duplicate task keys across sprints', () => {
    const plan = validPlan();
    plan.sprints[1].tasks[0].key = 'S1-T1';
    expect(SprintPlanContentSchema.safeParse(plan).success).toBe(false);
  });

  it('rejects an invalid (unknown) task dependency key', () => {
    const plan = validPlan();
    plan.sprints[0].tasks[1].dependencies = ['S9-T9'];
    expect(SprintPlanContentSchema.safeParse(plan).success).toBe(false);
  });

  it('rejects a task that depends on itself', () => {
    const plan = validPlan();
    plan.sprints[0].tasks[0].dependencies = ['S1-T1'];
    expect(SprintPlanContentSchema.safeParse(plan).success).toBe(false);
  });

  it('rejects a task dependency cycle', () => {
    const plan = validPlan();
    plan.sprints[0].tasks[0].dependencies = ['S1-T2'];
    plan.sprints[0].tasks[1].dependencies = ['S1-T1'];
    expect(SprintPlanContentSchema.safeParse(plan).success).toBe(false);
  });

  it('rejects an invalid (unknown) sprint dependency', () => {
    const plan = validPlan();
    plan.sprints[1].dependencies = [99];
    expect(SprintPlanContentSchema.safeParse(plan).success).toBe(false);
  });

  it('rejects a sprint depending on itself', () => {
    const plan = validPlan();
    plan.sprints[0].dependencies = [1];
    expect(SprintPlanContentSchema.safeParse(plan).success).toBe(false);
  });

  it('rejects a sprint depending on a later sprint', () => {
    const plan = validPlan();
    plan.sprints[0].dependencies = [2];
    expect(SprintPlanContentSchema.safeParse(plan).success).toBe(false);
  });

  it('rejects an invalid functional requirement id format', () => {
    const plan = validPlan();
    plan.sprints[0].tasks[1].requirementIds = ['requirement-one'];
    expect(SprintPlanContentSchema.safeParse(plan).success).toBe(false);
  });

  it('rejects a malformed validation expectation (invalid type)', () => {
    const plan = validPlan();
    (
      plan.sprints[0].tasks[0].validationExpectations[0] as Record<
        string,
        unknown
      >
    ).type = 'smoke_test';
    expect(SprintPlanContentSchema.safeParse(plan).success).toBe(false);
  });

  it('rejects empty acceptance criteria', () => {
    const plan = validPlan();
    plan.sprints[0].tasks[0].acceptanceCriteria = [];
    expect(SprintPlanContentSchema.safeParse(plan).success).toBe(false);
  });

  it('rejects a plan with no sprints', () => {
    const plan = { ...validPlan(), sprints: [] };
    expect(SprintPlanContentSchema.safeParse(plan).success).toBe(false);
  });

  it('rejects a sprint with no tasks', () => {
    const plan = validPlan();
    plan.sprints[0].tasks = [];
    expect(SprintPlanContentSchema.safeParse(plan).success).toBe(false);
  });

  it('rejects a task key that does not match its sprint number', () => {
    const plan = validPlan();
    plan.sprints[1].tasks[0].key = 'S1-T9';
    expect(SprintPlanContentSchema.safeParse(plan).success).toBe(false);
  });

  it('allows empty optional arrays (requirementIds, architectureAreas, dependencies)', () => {
    const plan = validPlan();
    plan.sprints[0].tasks[0].requirementIds = [];
    plan.sprints[0].tasks[0].architectureAreas = [];
    const result = SprintPlanContentSchema.safeParse(plan);
    expect(result.success).toBe(true);
  });
});
