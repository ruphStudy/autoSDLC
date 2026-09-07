import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ProjectAnalysis } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { SafeUser } from '../auth/types/auth.types';
import { ProjectAnalysisService } from './project-analysis.service';
import { EditProjectAnalysisDto } from './dto/edit-project-analysis.dto';
import { ProjectAnalysisVersionSummary } from './types/project-analysis.types';

@UseGuards(JwtAuthGuard)
@Controller('projects/:projectId/analysis')
export class ProjectAnalysisController {
  constructor(
    private readonly projectAnalysisService: ProjectAnalysisService,
  ) {}

  @Post('generate')
  generate(
    @CurrentUser() user: SafeUser,
    @Param('projectId') projectId: string,
  ): Promise<ProjectAnalysis> {
    return this.projectAnalysisService.generate(user.id, projectId);
  }

  @Post('regenerate')
  regenerate(
    @CurrentUser() user: SafeUser,
    @Param('projectId') projectId: string,
  ): Promise<ProjectAnalysis> {
    return this.projectAnalysisService.regenerate(user.id, projectId);
  }

  @Get()
  getCurrent(
    @CurrentUser() user: SafeUser,
    @Param('projectId') projectId: string,
  ): Promise<ProjectAnalysis> {
    return this.projectAnalysisService.getCurrent(user.id, projectId);
  }

  @Get('versions')
  listVersions(
    @CurrentUser() user: SafeUser,
    @Param('projectId') projectId: string,
  ): Promise<ProjectAnalysisVersionSummary[]> {
    return this.projectAnalysisService.listVersions(user.id, projectId);
  }

  @Get('versions/:version')
  getVersion(
    @CurrentUser() user: SafeUser,
    @Param('projectId') projectId: string,
    @Param('version', ParseIntPipe) version: number,
  ): Promise<ProjectAnalysis> {
    return this.projectAnalysisService.getVersion(user.id, projectId, version);
  }

  @Patch()
  @HttpCode(HttpStatus.OK)
  edit(
    @CurrentUser() user: SafeUser,
    @Param('projectId') projectId: string,
    @Body() dto: EditProjectAnalysisDto,
  ): Promise<ProjectAnalysis> {
    return this.projectAnalysisService.edit(user.id, projectId, dto);
  }
}
