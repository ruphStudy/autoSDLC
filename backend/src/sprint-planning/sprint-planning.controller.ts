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
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { SafeUser } from '../auth/types/auth.types';
import { SprintPlanningService } from './sprint-planning.service';
import { EditSprintPlanDto } from './dto/edit-sprint-plan.dto';
import {
  SprintPlanGraph,
  SprintPlanVersionSummary,
} from './types/sprint-plan.types';

@UseGuards(JwtAuthGuard)
@Controller('projects/:projectId/sprint-plan')
export class SprintPlanningController {
  constructor(private readonly sprintPlanningService: SprintPlanningService) {}

  @Post('generate')
  generate(
    @CurrentUser() user: SafeUser,
    @Param('projectId') projectId: string,
  ): Promise<SprintPlanGraph> {
    return this.sprintPlanningService.generate(user.id, projectId);
  }

  @Post('regenerate')
  regenerate(
    @CurrentUser() user: SafeUser,
    @Param('projectId') projectId: string,
  ): Promise<SprintPlanGraph> {
    return this.sprintPlanningService.regenerate(user.id, projectId);
  }

  @Get()
  getCurrent(
    @CurrentUser() user: SafeUser,
    @Param('projectId') projectId: string,
  ): Promise<SprintPlanGraph> {
    return this.sprintPlanningService.getCurrent(user.id, projectId);
  }

  @Get('versions')
  listVersions(
    @CurrentUser() user: SafeUser,
    @Param('projectId') projectId: string,
  ): Promise<SprintPlanVersionSummary[]> {
    return this.sprintPlanningService.listVersions(user.id, projectId);
  }

  @Get('versions/:version')
  getVersion(
    @CurrentUser() user: SafeUser,
    @Param('projectId') projectId: string,
    @Param('version', ParseIntPipe) version: number,
  ): Promise<SprintPlanGraph> {
    return this.sprintPlanningService.getVersion(user.id, projectId, version);
  }

  @Patch()
  @HttpCode(HttpStatus.OK)
  edit(
    @CurrentUser() user: SafeUser,
    @Param('projectId') projectId: string,
    @Body() dto: EditSprintPlanDto,
  ): Promise<SprintPlanGraph> {
    return this.sprintPlanningService.edit(user.id, projectId, dto);
  }
}
