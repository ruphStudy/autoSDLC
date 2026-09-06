import { IsIn, IsOptional } from 'class-validator';

export class ListProjectsQueryDto {
  @IsOptional()
  @IsIn(['true', 'false', 'all'])
  archived?: 'true' | 'false' | 'all';
}
