import type { AnalysisSource } from '../project-analysis/types';

export type { AnalysisSource };

export interface FrontendArchitecture {
  framework: string;
  language: string;
  renderingStrategy?: string;
  stateManagement?: string;
  routing?: string;
  styling?: string;
  componentStrategy: string;
  folderStructure: string[];
  keyLibraries: string[];
  notes: string[];
}

export interface BackendModule {
  name: string;
  responsibility: string;
}

export interface BackendArchitecture {
  framework: string;
  language: string;
  architecturalStyle: string;
  modules: BackendModule[];
  serviceBoundaries: string[];
  keyLibraries: string[];
  notes: string[];
}

export type ApiStyle = 'REST' | 'GraphQL' | 'RPC' | 'Mixed';

export interface ApiResourceGroup {
  name: string;
  purpose: string;
}

export interface ApiArchitecture {
  style: ApiStyle;
  versioningStrategy?: string;
  authenticationMechanism?: string;
  conventions: string[];
  majorResourceGroups: ApiResourceGroup[];
}

export interface DatabaseEntity {
  name: string;
  purpose: string;
  relationships: string[];
}

export interface DatabaseArchitecture {
  databaseType: string;
  technology: string;
  rationale: string;
  majorEntities: DatabaseEntity[];
  indexingStrategy: string[];
  migrationStrategy?: string;
  notes: string[];
}

export interface AuthenticationArchitecture {
  authenticationMethod: string;
  tokenOrSessionStrategy: string;
  authorizationModel: string;
  roles: string[];
  securityNotes: string[];
}

export type IntegrationDirection = 'inbound' | 'outbound' | 'bidirectional';

export interface IntegrationArchitectureItem {
  name: string;
  purpose: string;
  direction: IntegrationDirection;
  protocol?: string;
  authentication?: string;
  failureStrategy?: string;
}

export interface InfrastructureArchitecture {
  runtimeComponents: string[];
  compute?: string;
  database?: string;
  cache?: string;
  queue?: string;
  objectStorage?: string;
  networking: string[];
}

export interface DeploymentArchitecture {
  environments: string[];
  deploymentStrategy: string;
  hostingRecommendation?: string;
  ciCdApproach: string;
  configurationStrategy: string;
  secretsStrategy: string;
  rollbackStrategy?: string;
}

export interface SecurityControl {
  area: string;
  recommendation: string;
  rationale?: string;
}

export interface SecurityArchitecture {
  controls: SecurityControl[];
  dataProtection: string[];
  secretsManagement: string[];
  dependencySecurity: string[];
  loggingAndAudit: string[];
}

export interface TestApproach {
  approach: string;
  tools: string[];
}

export interface TestingStrategy {
  unitTesting: TestApproach;
  integrationTesting: TestApproach;
  apiTesting?: TestApproach;
  frontendTesting?: TestApproach;
  e2eTesting: TestApproach;
  validationCommands: string[];
}

export interface NonFunctionalDecision {
  requirement: string;
  decision: string;
  rationale: string;
}

export interface ArchitectureDecision {
  id: string;
  title: string;
  context: string;
  decision: string;
  rationale: string;
  alternativesConsidered: string[];
  consequences: string[];
}

export interface RequirementTraceability {
  requirementId: string;
  architectureAreas: string[];
  notes?: string;
}

export interface UnresolvedArchitectureQuestion {
  question: string;
  impact: string;
  recommendation?: string;
}

export interface Architecture {
  id: string;
  projectId: string;
  projectAnalysisId: string;
  version: number;
  source: AnalysisSource;
  basedOnVersion: number | null;
  summary: string;
  frontendArchitecture: FrontendArchitecture;
  backendArchitecture: BackendArchitecture;
  apiArchitecture: ApiArchitecture;
  databaseArchitecture: DatabaseArchitecture;
  authenticationArchitecture: AuthenticationArchitecture;
  integrationArchitecture: IntegrationArchitectureItem[];
  infrastructureArchitecture: InfrastructureArchitecture;
  deploymentArchitecture: DeploymentArchitecture;
  securityArchitecture: SecurityArchitecture;
  testingStrategy: TestingStrategy;
  nonFunctionalDecisions: NonFunctionalDecision[];
  architectureDecisions: ArchitectureDecision[];
  requirementTraceability: RequirementTraceability[];
  unresolvedQuestions: UnresolvedArchitectureQuestion[];
  constraints: string[];
  promptName: string | null;
  promptVersion: string | null;
  provider: string | null;
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  latencyMs: number | null;
  attempts: number | null;
  providerRequestId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ArchitectureVersionSummary {
  id: string;
  version: number;
  source: AnalysisSource;
  basedOnVersion: number | null;
  projectAnalysisId: string;
  promptVersion: string | null;
  provider: string | null;
  model: string | null;
  createdAt: string;
}

// Only the business-content fields a user may edit — never provider/model/
// tokens/version/projectId/projectAnalysisId. Matches EditArchitectureDto on
// the backend.
export interface ArchitectureEditPayload {
  summary?: string;
  frontendArchitecture?: FrontendArchitecture;
  backendArchitecture?: BackendArchitecture;
  apiArchitecture?: ApiArchitecture;
  databaseArchitecture?: DatabaseArchitecture;
  authenticationArchitecture?: AuthenticationArchitecture;
  integrationArchitecture?: IntegrationArchitectureItem[];
  infrastructureArchitecture?: InfrastructureArchitecture;
  deploymentArchitecture?: DeploymentArchitecture;
  securityArchitecture?: SecurityArchitecture;
  testingStrategy?: TestingStrategy;
  nonFunctionalDecisions?: NonFunctionalDecision[];
  architectureDecisions?: ArchitectureDecision[];
  requirementTraceability?: RequirementTraceability[];
  unresolvedQuestions?: UnresolvedArchitectureQuestion[];
  constraints?: string[];
}
