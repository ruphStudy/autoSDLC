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

export class CreateProjectDto {
  @Transform(trim)
  @IsString()
  @MinLength(1, { message: 'Project name is required' })
  @MaxLength(200)
  name!: string;

  @Transform(trim)
  @IsString()
  @MinLength(1, { message: 'Project brief is required' })
  @MaxLength(10000)
  brief!: string;

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
