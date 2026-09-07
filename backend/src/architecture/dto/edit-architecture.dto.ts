import { IsArray, IsObject, IsOptional, IsString } from 'class-validator';

// Deliberately loose per-field typing: this DTO's job is only to whitelist
// which top-level keys a client may send at all (so provider/model/tokens/
// version/projectId/projectAnalysisId can never be mass-assigned — they
// simply aren't declared here, and the global ValidationPipe's
// forbidNonWhitelisted rejects anything else). The actual business-rule
// validation of each section's *contents* is the shared
// ArchitectureFieldSchemas (zod), applied in the service — one canonical
// shape, not a second weaker one.
export class EditArchitectureDto {
  @IsOptional()
  @IsString()
  summary?: string;

  @IsOptional()
  @IsObject()
  frontendArchitecture?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  backendArchitecture?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  apiArchitecture?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  databaseArchitecture?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  authenticationArchitecture?: Record<string, unknown>;

  @IsOptional()
  @IsArray()
  integrationArchitecture?: unknown[];

  @IsOptional()
  @IsObject()
  infrastructureArchitecture?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  deploymentArchitecture?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  securityArchitecture?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  testingStrategy?: Record<string, unknown>;

  @IsOptional()
  @IsArray()
  nonFunctionalDecisions?: unknown[];

  @IsOptional()
  @IsArray()
  architectureDecisions?: unknown[];

  @IsOptional()
  @IsArray()
  requirementTraceability?: unknown[];

  @IsOptional()
  @IsArray()
  unresolvedQuestions?: unknown[];

  @IsOptional()
  @IsArray()
  constraints?: unknown[];
}
