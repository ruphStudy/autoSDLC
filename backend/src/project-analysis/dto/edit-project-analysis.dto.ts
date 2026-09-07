import { IsArray, IsOptional, IsString } from 'class-validator';

// Deliberately loose per-field typing: this DTO's job is only to whitelist
// which top-level keys a client may send at all (so provider/model/tokens/
// version/projectId can never be mass-assigned — they simply aren't declared
// here, and the global ValidationPipe's forbidNonWhitelisted rejects
// anything else). The actual business-rule validation of each section's
// *contents* is the shared ProjectAnalysisContentPatchSchema (zod), applied
// in the service — one canonical shape, not a second weaker one.
export class EditProjectAnalysisDto {
  @IsOptional()
  @IsString()
  summary?: string;

  @IsOptional()
  @IsArray()
  targetUsers?: unknown[];

  @IsOptional()
  @IsArray()
  goals?: unknown[];

  @IsOptional()
  @IsArray()
  features?: unknown[];

  @IsOptional()
  @IsArray()
  functionalRequirements?: unknown[];

  @IsOptional()
  @IsArray()
  nonFunctionalRequirements?: unknown[];

  @IsOptional()
  @IsArray()
  assumptions?: unknown[];

  @IsOptional()
  @IsArray()
  risks?: unknown[];

  @IsOptional()
  @IsArray()
  unresolvedQuestions?: unknown[];

  @IsOptional()
  @IsArray()
  integrations?: unknown[];
}
