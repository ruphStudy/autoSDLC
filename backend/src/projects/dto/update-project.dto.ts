import {
  IsEnum,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { RepositoryType } from '@prisma/client';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

// Deliberately excludes id/userId/createdAt/status/archivedAt: those are
// either immutable or owned by controlled operations (archive/restore, and
// future workflow transitions), never by a free-form edit.
export class UpdateProjectDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(1, { message: 'Project name cannot be blank' })
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(1, { message: 'Project brief cannot be blank' })
  @MaxLength(10000)
  brief?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(200)
  preferredStack?: string;

  @IsOptional()
  @IsEnum(RepositoryType)
  repositoryType?: RepositoryType;

  @IsOptional()
  @Transform(trim)
  @IsUrl(
    { require_tld: false },
    { message: 'Repository URL must be a valid URL' },
  )
  @MaxLength(500)
  repositoryUrl?: string;
}
