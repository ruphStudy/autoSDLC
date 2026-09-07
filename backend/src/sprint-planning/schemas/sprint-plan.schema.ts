import { z } from 'zod';
import { hasCycle } from '../utils/dependency-graph';

const NonEmptyString = (max: number) => z.string().min(1).max(max);

export const ValidationExpectationTypeSchema = z.enum([
  'lint',
  'typecheck',
  'unit_test',
  'integration_test',
  'e2e_test',
  'build',
  'manual',
  'other',
]);

const ValidationExpectationSchema = z.object({
  type: ValidationExpectationTypeSchema,
  description: NonEmptyString(500),
  required: z.boolean(),
});

const TASK_KEY_PATTERN = /^S\d+-T\d+$/;
const FR_ID_PATTERN = /^FR-\d{3,}$/;

const SprintPlanTaskSchema = z.object({
  key: z.string().regex(TASK_KEY_PATTERN, 'Task key must look like S1-T1'),
  title: NonEmptyString(200),
  description: NonEmptyString(2000),
  dependencies: z.array(z.string()).max(20).default([]),
  acceptanceCriteria: z.array(NonEmptyString(500)).min(1).max(20),
  validationExpectations: z.array(ValidationExpectationSchema).min(1).max(20),
  requirementIds: z
    .array(
      z.string().regex(FR_ID_PATTERN, 'requirementIds must look like FR-001'),
    )
    .max(20)
    .default([]),
  architectureAreas: z.array(z.string().min(1).max(100)).max(10).default([]),
});

const SprintPlanSprintSchema = z.object({
  number: z.number().int().min(1),
  title: NonEmptyString(200),
  objective: NonEmptyString(1000),
  description: z.string().max(2000).optional(),
  dependencies: z.array(z.number().int()).max(20).default([]),
  tasks: z.array(SprintPlanTaskSchema).min(1).max(30),
});

function dedupeCount<T>(items: T[]): number {
  return new Set(items).size;
}

/**
 * Structural graph validation shared by AI output and manual edits: sprint
 * numbering, task-key uniqueness, and dependency validity (existence,
 * no self-reference, no cycles). This is entirely self-contained (it only
 * needs the plan's own data) — validating that referenced requirement ids
 * actually exist on the source ProjectAnalysis, and that every requirement
 * is covered, needs the live analysis and happens at the service layer
 * instead (see sprint-planning.service.ts), the same split Sprint 5 used
 * for architecture requirement traceability.
 */
function validatePlanGraph(
  data: { sprints: z.infer<typeof SprintPlanSprintSchema>[] },
  ctx: z.RefinementCtx,
): void {
  const sprintNumbers = data.sprints.map((s) => s.number);
  if (dedupeCount(sprintNumbers) !== sprintNumbers.length) {
    ctx.addIssue({
      code: 'custom',
      message: 'Sprint numbers must be unique',
      path: ['sprints'],
    });
  }

  const sorted = [...sprintNumbers].sort((a, b) => a - b);
  const contiguousFromOne = sorted.every((n, i) => n === i + 1);
  if (!contiguousFromOne) {
    ctx.addIssue({
      code: 'custom',
      message: 'Sprint numbers must be contiguous starting at 1',
      path: ['sprints'],
    });
  }

  const sprintNumberSet = new Set(sprintNumbers);
  const sprintEdges = new Map<string, string[]>();

  data.sprints.forEach((sprint, sprintIndex) => {
    sprintEdges.set(String(sprint.number), sprint.dependencies.map(String));

    if (dedupeCount(sprint.dependencies) !== sprint.dependencies.length) {
      ctx.addIssue({
        code: 'custom',
        message: `Sprint ${sprint.number} has duplicate dependencies`,
        path: ['sprints', sprintIndex, 'dependencies'],
      });
    }

    sprint.dependencies.forEach((dep, depIndex) => {
      if (dep === sprint.number) {
        ctx.addIssue({
          code: 'custom',
          message: `Sprint ${sprint.number} cannot depend on itself`,
          path: ['sprints', sprintIndex, 'dependencies', depIndex],
        });
      } else if (!sprintNumberSet.has(dep)) {
        ctx.addIssue({
          code: 'custom',
          message: `Sprint ${sprint.number} depends on unknown sprint ${dep}`,
          path: ['sprints', sprintIndex, 'dependencies', depIndex],
        });
      } else if (dep >= sprint.number) {
        ctx.addIssue({
          code: 'custom',
          message: `Sprint ${sprint.number} may only depend on an earlier sprint (got ${dep})`,
          path: ['sprints', sprintIndex, 'dependencies', depIndex],
        });
      }
    });
  });

  // Sprint cycles are structurally impossible given the "earlier sprint
  // only" rule above, but cycle detection is cheap and future-proofs this
  // if that rule is ever relaxed.
  if (hasCycle(sortedUnique(sprintNumbers).map(String), sprintEdges)) {
    ctx.addIssue({
      code: 'custom',
      message: 'Sprint dependencies contain a cycle',
      path: ['sprints'],
    });
  }

  const allTasks = data.sprints.flatMap((sprint, sprintIndex) =>
    sprint.tasks.map((task, taskIndex) => ({
      sprint,
      sprintIndex,
      task,
      taskIndex,
    })),
  );
  const allTaskKeys = allTasks.map((t) => t.task.key);
  if (dedupeCount(allTaskKeys) !== allTaskKeys.length) {
    ctx.addIssue({
      code: 'custom',
      message: 'Task keys must be unique across the entire plan',
      path: ['sprints'],
    });
  }
  const taskKeySet = new Set(allTaskKeys);

  for (const { sprint, sprintIndex, task, taskIndex } of allTasks) {
    if (!task.key.startsWith(`S${sprint.number}-`)) {
      ctx.addIssue({
        code: 'custom',
        message: `Task key ${task.key} does not match its containing sprint number ${sprint.number}`,
        path: ['sprints', sprintIndex, 'tasks', taskIndex, 'key'],
      });
    }

    if (dedupeCount(task.dependencies) !== task.dependencies.length) {
      ctx.addIssue({
        code: 'custom',
        message: `Task ${task.key} has duplicate dependencies`,
        path: ['sprints', sprintIndex, 'tasks', taskIndex, 'dependencies'],
      });
    }

    task.dependencies.forEach((dep, depIndex) => {
      if (dep === task.key) {
        ctx.addIssue({
          code: 'custom',
          message: `Task ${task.key} cannot depend on itself`,
          path: [
            'sprints',
            sprintIndex,
            'tasks',
            taskIndex,
            'dependencies',
            depIndex,
          ],
        });
      } else if (!taskKeySet.has(dep)) {
        ctx.addIssue({
          code: 'custom',
          message: `Task ${task.key} depends on unknown task ${dep}`,
          path: [
            'sprints',
            sprintIndex,
            'tasks',
            taskIndex,
            'dependencies',
            depIndex,
          ],
        });
      }
    });
  }

  const taskEdges = new Map<string, string[]>(
    allTasks.map((t) => [t.task.key, t.task.dependencies]),
  );
  if (hasCycle(allTaskKeys, taskEdges)) {
    ctx.addIssue({
      code: 'custom',
      message: 'Task dependencies contain a cycle',
      path: ['sprints'],
    });
  }
}

function sortedUnique(numbers: number[]): number[] {
  return Array.from(new Set(numbers)).sort((a, b) => a - b);
}

// The canonical SprintPlan shape. Same design as ProjectAnalysis/Architecture:
// practical max lengths, empty-array defaults, one shape reused for both AI
// output and manual edits (SprintPlan editing sends the whole structure back,
// so there is no separate per-field patch schema here — see
// sprint-planning.service.ts).
export const SprintPlanContentSchema = z
  .object({
    summary: NonEmptyString(2000),
    strategy: NonEmptyString(2000),
    sprints: z.array(SprintPlanSprintSchema).min(1).max(30),
  })
  .superRefine(validatePlanGraph);

export type SprintPlanContent = z.infer<typeof SprintPlanContentSchema>;
export type SprintPlanTaskContent = z.infer<typeof SprintPlanTaskSchema>;
export type SprintPlanSprintContent = z.infer<typeof SprintPlanSprintSchema>;
export type ValidationExpectation = z.infer<typeof ValidationExpectationSchema>;
