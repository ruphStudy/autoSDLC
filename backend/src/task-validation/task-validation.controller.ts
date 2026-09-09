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
import { TaskValidationService } from './task-validation.service';
import {
  TaskValidationEligibilityResult,
  ValidateTaskResult,
  ValidationAttemptRecord,
} from './types/validation-record.types';

// No route here ever accepts a command/script from the client (item 23) —
// every ValidationCheck is resolved server-side (ValidationPlanResolver)
// against the repository's own tooling. "validate" takes only the ids
// already in the URL.
@UseGuards(JwtAuthGuard)
@Controller('projects/:projectId')
export class TaskValidationController {
  constructor(private readonly taskValidationService: TaskValidationService) {}

  @Post('tasks/:taskId/validate')
  @HttpCode(HttpStatus.ACCEPTED)
  validate(
    @CurrentUser() user: SafeUser,
    @Param('projectId') projectId: string,
    @Param('taskId') taskId: string,
  ): Promise<ValidateTaskResult> {
    return this.taskValidationService.validate(user.id, projectId, taskId);
  }

  @Get('tasks/:taskId/validation-eligibility')
  getEligibility(
    @CurrentUser() user: SafeUser,
    @Param('projectId') projectId: string,
    @Param('taskId') taskId: string,
  ): Promise<TaskValidationEligibilityResult> {
    return this.taskValidationService.getEligibility(
      user.id,
      projectId,
      taskId,
    );
  }

  @Get('tasks/:taskId/validations')
  listValidations(
    @CurrentUser() user: SafeUser,
    @Param('projectId') projectId: string,
    @Param('taskId') taskId: string,
  ): Promise<ValidationAttemptRecord[]> {
    return this.taskValidationService.listValidations(
      user.id,
      projectId,
      taskId,
    );
  }

  @Get('validations/:validationAttemptId')
  getValidation(
    @CurrentUser() user: SafeUser,
    @Param('projectId') projectId: string,
    @Param('validationAttemptId') validationAttemptId: string,
  ): Promise<ValidationAttemptRecord> {
    return this.taskValidationService.getValidation(
      user.id,
      projectId,
      validationAttemptId,
    );
  }
}
