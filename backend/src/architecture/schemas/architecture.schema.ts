import { z } from 'zod';

// Shared across: (1) validating the AI provider's structured output, and
// (2) validating a user's manual edit — one canonical shape, not two
// diverging ones (see ProjectAnalysisContentSchema for the same pattern).
const NonEmptyString = (max: number) => z.string().min(1).max(max);

const FrontendArchitectureSchema = z.object({
  framework: NonEmptyString(100),
  language: NonEmptyString(100),
  renderingStrategy: z.string().max(200).optional(),
  stateManagement: z.string().max(200).optional(),
  routing: z.string().max(200).optional(),
  styling: z.string().max(200).optional(),
  componentStrategy: NonEmptyString(500),
  folderStructure: z.array(z.string().min(1).max(200)).max(30).default([]),
  keyLibraries: z.array(z.string().min(1).max(100)).max(30).default([]),
  notes: z.array(z.string().min(1).max(500)).max(20).default([]),
});

const BackendModuleSchema = z.object({
  name: NonEmptyString(100),
  responsibility: NonEmptyString(500),
});

const BackendArchitectureSchema = z.object({
  framework: NonEmptyString(100),
  language: NonEmptyString(100),
  architecturalStyle: NonEmptyString(200),
  modules: z.array(BackendModuleSchema).min(1).max(30),
  serviceBoundaries: z.array(z.string().min(1).max(300)).max(20).default([]),
  keyLibraries: z.array(z.string().min(1).max(100)).max(30).default([]),
  notes: z.array(z.string().min(1).max(500)).max(20).default([]),
});

const ApiResourceGroupSchema = z.object({
  name: NonEmptyString(100),
  purpose: NonEmptyString(500),
});

const ApiArchitectureSchema = z.object({
  style: z.enum(['REST', 'GraphQL', 'RPC', 'Mixed']),
  versioningStrategy: z.string().max(300).optional(),
  authenticationMechanism: z.string().max(300).optional(),
  conventions: z.array(z.string().min(1).max(300)).max(30).default([]),
  majorResourceGroups: z.array(ApiResourceGroupSchema).max(40).default([]),
});

const DatabaseEntitySchema = z.object({
  name: NonEmptyString(100),
  purpose: NonEmptyString(500),
  relationships: z.array(z.string().min(1).max(300)).max(20).default([]),
});

const DatabaseArchitectureSchema = z.object({
  databaseType: NonEmptyString(100),
  technology: NonEmptyString(100),
  rationale: NonEmptyString(1000),
  majorEntities: z.array(DatabaseEntitySchema).max(60).default([]),
  indexingStrategy: z.array(z.string().min(1).max(300)).max(20).default([]),
  migrationStrategy: z.string().max(500).optional(),
  notes: z.array(z.string().min(1).max(500)).max(20).default([]),
});

const AuthenticationArchitectureSchema = z.object({
  authenticationMethod: NonEmptyString(300),
  tokenOrSessionStrategy: NonEmptyString(300),
  authorizationModel: NonEmptyString(300),
  roles: z.array(z.string().min(1).max(100)).max(20).default([]),
  securityNotes: z.array(z.string().min(1).max(500)).max(20).default([]),
});

const IntegrationArchitectureItemSchema = z.object({
  name: NonEmptyString(100),
  purpose: NonEmptyString(500),
  direction: z.enum(['inbound', 'outbound', 'bidirectional']),
  protocol: z.string().max(100).optional(),
  authentication: z.string().max(200).optional(),
  failureStrategy: z.string().max(500).optional(),
});

const InfrastructureArchitectureSchema = z.object({
  runtimeComponents: z.array(z.string().min(1).max(200)).max(20).default([]),
  compute: z.string().max(300).optional(),
  database: z.string().max(300).optional(),
  cache: z.string().max(300).optional(),
  queue: z.string().max(300).optional(),
  objectStorage: z.string().max(300).optional(),
  networking: z.array(z.string().min(1).max(300)).max(20).default([]),
});

const DeploymentArchitectureSchema = z.object({
  environments: z.array(z.string().min(1).max(100)).max(10).default([]),
  deploymentStrategy: NonEmptyString(500),
  hostingRecommendation: z.string().max(300).optional(),
  ciCdApproach: NonEmptyString(500),
  configurationStrategy: NonEmptyString(500),
  secretsStrategy: NonEmptyString(500),
  rollbackStrategy: z.string().max(500).optional(),
});

const SecurityControlSchema = z.object({
  area: NonEmptyString(100),
  recommendation: NonEmptyString(500),
  rationale: z.string().max(500).optional(),
});

const SecurityArchitectureSchema = z.object({
  controls: z.array(SecurityControlSchema).max(30).default([]),
  dataProtection: z.array(z.string().min(1).max(300)).max(20).default([]),
  secretsManagement: z.array(z.string().min(1).max(300)).max(20).default([]),
  dependencySecurity: z.array(z.string().min(1).max(300)).max(20).default([]),
  loggingAndAudit: z.array(z.string().min(1).max(300)).max(20).default([]),
});

const TestApproachSchema = z.object({
  approach: NonEmptyString(500),
  tools: z.array(z.string().min(1).max(100)).max(10).default([]),
});

const TestingStrategySchema = z.object({
  unitTesting: TestApproachSchema,
  integrationTesting: TestApproachSchema,
  apiTesting: TestApproachSchema.optional(),
  frontendTesting: TestApproachSchema.optional(),
  e2eTesting: TestApproachSchema,
  validationCommands: z.array(z.string().min(1).max(100)).max(20).default([]),
});

const NonFunctionalDecisionSchema = z.object({
  requirement: NonEmptyString(300),
  decision: NonEmptyString(500),
  rationale: NonEmptyString(500),
});

const ADR_ID_PATTERN = /^ADR-\d{3,}$/;

const ArchitectureDecisionSchema = z.object({
  id: z.string().regex(ADR_ID_PATTERN, 'ADR id must look like ADR-001'),
  title: NonEmptyString(200),
  context: NonEmptyString(1000),
  decision: NonEmptyString(1000),
  rationale: NonEmptyString(1000),
  alternativesConsidered: z
    .array(z.string().min(1).max(300))
    .max(10)
    .default([]),
  consequences: z.array(z.string().min(1).max(300)).max(10).default([]),
});

function uniqueIds(items: { id: string }[]): boolean {
  return new Set(items.map((item) => item.id)).size === items.length;
}

const RequirementTraceabilitySchema = z.object({
  requirementId: z
    .string()
    .regex(/^FR-\d{3,}$/, 'requirementId must look like FR-001'),
  architectureAreas: z.array(z.string().min(1).max(100)).min(1).max(10),
  notes: z.string().max(500).optional(),
});

const UnresolvedArchitectureQuestionSchema = z.object({
  question: NonEmptyString(500),
  impact: NonEmptyString(500),
  recommendation: z.string().max(500).optional(),
});

// The canonical Architecture shape. Mirrors ProjectAnalysisContentSchema's
// design: practical max lengths everywhere, empty-array defaults (never
// null), one shape reused for both AI output and manual edits.
export const ArchitectureContentSchema = z.object({
  summary: NonEmptyString(2000),
  frontendArchitecture: FrontendArchitectureSchema,
  backendArchitecture: BackendArchitectureSchema,
  apiArchitecture: ApiArchitectureSchema,
  databaseArchitecture: DatabaseArchitectureSchema,
  authenticationArchitecture: AuthenticationArchitectureSchema,
  integrationArchitecture: z
    .array(IntegrationArchitectureItemSchema)
    .max(20)
    .default([]),
  infrastructureArchitecture: InfrastructureArchitectureSchema,
  deploymentArchitecture: DeploymentArchitectureSchema,
  securityArchitecture: SecurityArchitectureSchema,
  testingStrategy: TestingStrategySchema,
  nonFunctionalDecisions: z
    .array(NonFunctionalDecisionSchema)
    .max(20)
    .default([]),
  architectureDecisions: z
    .array(ArchitectureDecisionSchema)
    .max(30)
    .default([])
    .refine(uniqueIds, { message: 'ADR ids must be unique' }),
  requirementTraceability: z
    .array(RequirementTraceabilitySchema)
    .max(100)
    .default([]),
  unresolvedQuestions: z
    .array(UnresolvedArchitectureQuestionSchema)
    .max(20)
    .default([]),
  constraints: z.array(z.string().min(1).max(300)).max(20).default([]),
});

export type ArchitectureContent = z.infer<typeof ArchitectureContentSchema>;

// Exposed so a manual edit can validate exactly the fields a user provided,
// one at a time, against the same per-field rules the AI output must
// satisfy — see architecture.service.ts. (Whole-object `.partial()` is
// deliberately avoided: zod resolves an omitted `.default([])` array field
// to `[]` rather than `undefined` under `.partial()`, which would silently
// wipe unedited sections. This bit Sprint 4's ProjectAnalysis edit endpoint;
// per-field validation sidesteps it here from the start.)
export const ArchitectureFieldSchemas = ArchitectureContentSchema.shape;
