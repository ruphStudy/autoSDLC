import { z } from 'zod';

const NonEmptyString = (max: number) => z.string().min(1).max(max);

const ImplementationStepSchema = z.object({
  step: z.number().int().min(1),
  description: NonEmptyString(1000),
  likelyFiles: z.array(NonEmptyString(500)).max(20).default([]),
});

const ValidationPlanItemSchema = z.object({
  type: NonEmptyString(100),
  description: NonEmptyString(500),
  required: z.boolean(),
});

const DependencyContextItemSchema = z.object({
  taskKey: NonEmptyString(50),
  summary: NonEmptyString(1000),
});

// Structured instruction contract (item 31). `finalInstruction`'s static
// ceiling here is a sanity backstop against a pathologically long response —
// the real configurable bound (TASK_INSTRUCTION_MAX_CHARS) is enforced by
// TaskInstructionService after schema validation, since a zod schema can't
// see runtime config.
export const TaskInstructionContentSchema = z.object({
  objective: NonEmptyString(2000),
  repositoryObservations: z.array(NonEmptyString(1000)).max(20).default([]),
  implementationPlan: z.array(ImplementationStepSchema).min(1).max(30),
  constraints: z.array(NonEmptyString(500)).max(30).default([]),
  acceptanceCriteria: z.array(NonEmptyString(500)).min(1).max(30),
  validationPlan: z.array(ValidationPlanItemSchema).min(1).max(30),
  dependencyContext: z.array(DependencyContextItemSchema).max(30).default([]),
  risksOrWatchouts: z.array(NonEmptyString(500)).max(20).default([]),
  // Which of the Task's own requirementIds this instruction addresses —
  // validated against Task.requirementIds by the service (item 80); the AI
  // must never introduce a requirement id the Task doesn't already have.
  requirementIds: z.array(NonEmptyString(50)).max(30).default([]),
  finalInstruction: z.string().min(1).max(100000),
});

export type TaskInstructionContent = z.infer<
  typeof TaskInstructionContentSchema
>;
