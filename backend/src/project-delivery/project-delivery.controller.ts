import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { SafeUser } from '../auth/types/auth.types';
import { ProjectDeliveryService } from './project-delivery.service';
import {
  CompleteProjectResult,
  ProjectCompletionEligibilityResult,
  ProjectDeliveryRecord,
} from './types/project-delivery.types';

// No route here ever accepts completion content from the client (item
// 158/162) — the server always computes eligibility and the delivery
// manifest itself; completion takes no request body at all.
@UseGuards(JwtAuthGuard)
@Controller('projects/:projectId')
export class ProjectDeliveryController {
  constructor(
    private readonly projectDeliveryService: ProjectDeliveryService,
  ) {}

  @Get('completion-eligibility')
  getEligibility(
    @CurrentUser() user: SafeUser,
    @Param('projectId') projectId: string,
  ): Promise<ProjectCompletionEligibilityResult> {
    return this.projectDeliveryService.getEligibility(user.id, projectId);
  }

  @Post('complete')
  @HttpCode(HttpStatus.OK)
  complete(
    @CurrentUser() user: SafeUser,
    @Param('projectId') projectId: string,
  ): Promise<CompleteProjectResult> {
    return this.projectDeliveryService.complete(user.id, projectId);
  }

  @Get('delivery')
  getCurrent(
    @CurrentUser() user: SafeUser,
    @Param('projectId') projectId: string,
  ): Promise<ProjectDeliveryRecord> {
    return this.projectDeliveryService.getCurrent(user.id, projectId);
  }
}
