import { z } from 'zod';

// Shared across: (1) validating the AI provider's structured output, and
// (2) validating a user's manual edit — one canonical shape, not two
// diverging ones. MoSCoW is used for features/functional requirements
// (explicit MVP-vs-later scoping); everything else uses a plain
// high/medium/low importance scale.
const MoscowPriority = z.enum(['must_have', 'should_have', 'could_have']);
const ImportanceLevel = z.enum(['high', 'medium', 'low']);

const TargetUserSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().min(1).max(1000),
  needs: z.array(z.string().min(1).max(300)).max(20).default([]),
});

const GoalSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(1000),
  priority: ImportanceLevel.optional(),
});

const FeatureSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().min(1).max(1000),
  priority: MoscowPriority,
});

const FR_ID_PATTERN = /^FR-\d{3,}$/;

const FunctionalRequirementSchema = z.object({
  id: z
    .string()
    .regex(FR_ID_PATTERN, 'Functional requirement id must look like FR-001'),
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(1000),
  priority: MoscowPriority,
});

const NonFunctionalRequirementSchema = z.object({
  category: z.string().min(1).max(100),
  requirement: z.string().min(1).max(1000),
  priority: ImportanceLevel.optional(),
});

const AssumptionSchema = z.object({
  assumption: z.string().min(1).max(500),
  impact: z.string().max(500).optional(),
});

const RiskSchema = z.object({
  risk: z.string().min(1).max(500),
  severity: ImportanceLevel,
  mitigation: z.string().max(500).optional(),
});

const UnresolvedQuestionSchema = z.object({
  question: z.string().min(1).max(500),
  importance: ImportanceLevel,
  reason: z.string().max(500).optional(),
});

const IntegrationSchema = z.object({
  name: z.string().min(1).max(200),
  purpose: z.string().min(1).max(500),
  required: z.boolean(),
  notes: z.string().max(500).optional(),
});

function uniqueFunctionalRequirementIds(items: { id: string }[]): boolean {
  return new Set(items.map((item) => item.id)).size === items.length;
}

// The canonical Project Analysis shape. Practical max lengths on every array
// keep AI output (and manual edits) bounded — this is a requirements
// document, not an open-ended dataset.
export const ProjectAnalysisContentSchema = z.object({
  summary: z.string().min(1).max(2000),
  targetUsers: z.array(TargetUserSchema).max(10).default([]),
  goals: z.array(GoalSchema).max(15).default([]),
  features: z.array(FeatureSchema).max(40).default([]),
  functionalRequirements: z
    .array(FunctionalRequirementSchema)
    .max(60)
    .default([])
    .refine(uniqueFunctionalRequirementIds, {
      message: 'Functional requirement ids must be unique',
    }),
  nonFunctionalRequirements: z
    .array(NonFunctionalRequirementSchema)
    .max(30)
    .default([]),
  assumptions: z.array(AssumptionSchema).max(20).default([]),
  risks: z.array(RiskSchema).max(20).default([]),
  unresolvedQuestions: z.array(UnresolvedQuestionSchema).max(20).default([]),
  integrations: z.array(IntegrationSchema).max(20).default([]),
});

export type ProjectAnalysisContent = z.infer<
  typeof ProjectAnalysisContentSchema
>;

// Exposed so a manual edit can validate exactly the fields a user provided,
// one at a time, against the same per-field rules the AI output must satisfy
// — see project-analysis.service.ts. (Whole-object `.partial()` was tried
// here first, but zod resolves an omitted `.default([])` array field to `[]`
// rather than `undefined` under `.partial()`, which would silently wipe
// unedited sections on every edit. Per-field validation sidesteps that.)
export const ProjectAnalysisFieldSchemas = ProjectAnalysisContentSchema.shape;
