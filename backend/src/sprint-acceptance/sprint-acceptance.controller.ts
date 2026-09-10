import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { SafeUser } from '../auth/types/auth.types';
import { SprintAcceptanceService } from './sprint-acceptance.service';
import { AcceptSprintDto, RejectSprintDto } from './dto/decide-acceptance.dto';
import {
  GenerateAcceptanceResult,
  SprintAcceptanceEligibilityResult,
  SprintAcceptanceRecord,
} from './types/sprint-acceptance.types';

// No route here ever accepts a review verdict, finding, or AI content from
// the client (item 101/146) — the server always computes evidence and
// (optionally) the AI review itself; the client only ever supplies notes/a
// rejection reason for the human decision.
@UseGuards(JwtAuthGuard)
@Controller('projects/:projectId')
export class SprintAcceptanceController {
  constructor(
    private readonly sprintAcceptanceService: SprintAcceptanceService,
  ) {}

  @Get('sprints/:sprintId/acceptance-eligibility')
  getEligibility(
    @CurrentUser() user: SafeUser,
    @Param('projectId') projectId: string,
    @Param('sprintId') sprintId: string,
  ): Promise<SprintAcceptanceEligibilityResult> {
    return this.sprintAcceptanceService.getEligibility(
      user.id,
      projectId,
      sprintId,
    );
  }

  @Post('sprints/:sprintId/acceptance/generate')
  @HttpCode(HttpStatus.ACCEPTED)
  generate(
    @CurrentUser() user: SafeUser,
    @Param('projectId') projectId: string,
    @Param('sprintId') sprintId: string,
  ): Promise<GenerateAcceptanceResult> {
    return this.sprintAcceptanceService.generate(user.id, projectId, sprintId);
  }

  @Post('sprints/:sprintId/acceptance/regenerate')
  @HttpCode(HttpStatus.ACCEPTED)
  regenerate(
    @CurrentUser() user: SafeUser,
    @Param('projectId') projectId: string,
    @Param('sprintId') sprintId: string,
  ): Promise<GenerateAcceptanceResult> {
    return this.sprintAcceptanceService.generate(user.id, projectId, sprintId);
  }

  @Get('sprints/:sprintId/acceptance')
  getCurrent(
    @CurrentUser() user: SafeUser,
    @Param('projectId') projectId: string,
    @Param('sprintId') sprintId: string,
  ): Promise<SprintAcceptanceRecord> {
    return this.sprintAcceptanceService.getCurrent(
      user.id,
      projectId,
      sprintId,
    );
  }

  @Get('sprints/:sprintId/acceptance/versions')
  getHistory(
    @CurrentUser() user: SafeUser,
    @Param('projectId') projectId: string,
    @Param('sprintId') sprintId: string,
  ): Promise<SprintAcceptanceRecord[]> {
    return this.sprintAcceptanceService.getHistory(
      user.id,
      projectId,
      sprintId,
    );
  }

  @Get('sprints/:sprintId/acceptance/versions/:version')
  getVersion(
    @CurrentUser() user: SafeUser,
    @Param('projectId') projectId: string,
    @Param('sprintId') sprintId: string,
    @Param('version', ParseIntPipe) version: number,
  ): Promise<SprintAcceptanceRecord> {
    return this.sprintAcceptanceService.getVersion(
      user.id,
      projectId,
      sprintId,
      version,
    );
  }

  @Post('sprints/:sprintId/acceptance/accept')
  accept(
    @CurrentUser() user: SafeUser,
    @Param('projectId') projectId: string,
    @Param('sprintId') sprintId: string,
    @Body() dto: AcceptSprintDto,
  ): Promise<SprintAcceptanceRecord> {
    return this.sprintAcceptanceService.accept(
      user.id,
      projectId,
      sprintId,
      dto,
    );
  }

  @Post('sprints/:sprintId/acceptance/reject')
  reject(
    @CurrentUser() user: SafeUser,
    @Param('projectId') projectId: string,
    @Param('sprintId') sprintId: string,
    @Body() dto: RejectSprintDto,
  ): Promise<SprintAcceptanceRecord> {
    return this.sprintAcceptanceService.reject(
      user.id,
      projectId,
      sprintId,
      dto,
    );
  }
}
