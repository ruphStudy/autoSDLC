import { z } from 'zod';

const NonEmptyString = (max: number) => z.string().min(1).max(max);

const FindingSeveritySchema = z.enum([
  'INFO',
  'LOW',
  'MEDIUM',
  'HIGH',
  'CRITICAL',
]);
const FindingCategorySchema = z.enum([
  'REQUIREMENT',
  'ARCHITECTURE',
  'VALIDATION',
  'SECURITY',
  'QUALITY',
  'TESTING',
  'RISK',
  'DOCUMENTATION',
  'OTHER',
]);

// Bounded on every array/string (item 24/123) — a review finding is a
// pointer into already-bounded evidence, never a place to smuggle a large
// blob of free text.
const ReviewFindingSchema = z.object({
  id: NonEmptyString(50),
  severity: FindingSeveritySchema,
  category: FindingCategorySchema,
  title: NonEmptyString(200),
  description: NonEmptyString(1000),
  evidence: z.array(z.string().min(1).max(300)).max(10).default([]),
  relatedTaskKeys: z.array(z.string().min(1).max(50)).max(20).default([]),
  relatedRequirementIds: z.array(z.string().min(1).max(50)).max(20).default([]),
  relatedAdrIds: z.array(z.string().min(1).max(50)).max(20).default([]),
  blocking: z.boolean().default(false),
});

function uniqueFindingIds(items: { id: string }[]): boolean {
  return new Set(items.map((item) => item.id)).size === items.length;
}

// The exact structured shape the AI reviewer must return (item 30) —
// recommendation is advisory only (item 116), never itself the acceptance
// `status`.
export const SprintAcceptanceReviewContentSchema = z.object({
  summary: NonEmptyString(2000),
  objectiveAssessment: z.object({
    satisfied: z.boolean(),
    rationale: NonEmptyString(1000),
  }),
  requirementAssessment: z.object({
    satisfied: z.boolean(),
    gaps: z.array(z.string().min(1).max(300)).max(20).default([]),
  }),
  architectureAssessment: z.object({
    aligned: z.boolean(),
    concerns: z.array(z.string().min(1).max(300)).max(20).default([]),
  }),
  validationAssessment: z.object({
    sufficient: z.boolean(),
    concerns: z.array(z.string().min(1).max(300)).max(20).default([]),
  }),
  riskAssessment: z.object({
    acceptable: z.boolean(),
    concerns: z.array(z.string().min(1).max(300)).max(20).default([]),
  }),
  findings: z
    .array(ReviewFindingSchema)
    .max(30)
    .default([])
    .refine(uniqueFindingIds, { message: 'Finding ids must be unique' }),
  recommendation: z.enum([
    'ACCEPT',
    'ACCEPT_WITH_NOTES',
    'NEEDS_ATTENTION',
    'REJECT',
  ]),
});

export type SprintAcceptanceReviewContent = z.infer<
  typeof SprintAcceptanceReviewContentSchema
>;
