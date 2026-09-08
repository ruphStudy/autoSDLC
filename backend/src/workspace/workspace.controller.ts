import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseBoolPipe,
  Post,
  Query,
} from '@nestjs/common';
import { UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { SafeUser } from '../auth/types/auth.types';
import { WorkspaceService } from './workspace.service';
import { RepositoryReadiness } from './git/git.types';
import { JobRecord } from '../jobs/types/job.types';
import {
  WorkspaceDiffResult,
  WorkspaceRecord,
  WorkspaceStatusResult,
} from './types/workspace.types';

@UseGuards(JwtAuthGuard)
@Controller('projects/:projectId/workspace')
export class WorkspaceController {
  constructor(private readonly workspaceService: WorkspaceService) {}

  @Get()
  get(
    @CurrentUser() user: SafeUser,
    @Param('projectId') projectId: string,
  ): Promise<WorkspaceRecord> {
    return this.workspaceService.getWorkspace(user.id, projectId);
  }

  @Post('prepare')
  @HttpCode(HttpStatus.ACCEPTED)
  prepare(
    @CurrentUser() user: SafeUser,
    @Param('projectId') projectId: string,
  ): Promise<{ workspace: WorkspaceRecord; job: JobRecord }> {
    return this.workspaceService.prepare(user.id, projectId);
  }

  @Post('validate')
  validate(
    @CurrentUser() user: SafeUser,
    @Param('projectId') projectId: string,
  ): Promise<RepositoryReadiness> {
    return this.workspaceService.validate(user.id, projectId);
  }

  @Get('status')
  status(
    @CurrentUser() user: SafeUser,
    @Param('projectId') projectId: string,
  ): Promise<WorkspaceStatusResult> {
    return this.workspaceService.getGitStatus(user.id, projectId);
  }

  @Get('diff')
  diff(
    @CurrentUser() user: SafeUser,
    @Param('projectId') projectId: string,
    @Query('staged', new ParseBoolPipe({ optional: true })) staged?: boolean,
  ): Promise<WorkspaceDiffResult> {
    return this.workspaceService.getDiff(user.id, projectId, { staged });
  }

  @Delete()
  @HttpCode(HttpStatus.OK)
  cleanup(
    @CurrentUser() user: SafeUser,
    @Param('projectId') projectId: string,
  ): Promise<WorkspaceRecord> {
    return this.workspaceService.cleanup(user.id, projectId);
  }
}
