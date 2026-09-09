import {
  BadRequestException,
  ConflictException,
  HttpException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  TaskInstructionError,
  TaskInstructionErrorCode,
} from './task-instruction.error';

export function mapTaskInstructionErrorToHttpException(
  error: TaskInstructionError,
): HttpException {
  const body = { code: error.code, message: error.message };

  switch (error.code) {
    case TaskInstructionErrorCode.TASK_NOT_FOUND:
      return new NotFoundException(body);

    case TaskInstructionErrorCode.TASK_NOT_IN_CURRENT_PLAN:
    case TaskInstructionErrorCode.PLAN_NOT_APPROVED:
    case TaskInstructionErrorCode.WORKSPACE_NOT_READY:
    case TaskInstructionErrorCode.WORKSPACE_DIRTY:
    case TaskInstructionErrorCode.REPOSITORY_STATE_CHANGED:
    case TaskInstructionErrorCode.GENERATION_IN_PROGRESS:
      return new ConflictException(body);

    case TaskInstructionErrorCode.CONTEXT_BUILD_FAILED:
    case TaskInstructionErrorCode.INVALID_INSTRUCTION_RESPONSE:
      return new UnprocessableEntityException(body);

    default:
      return new BadRequestException(body);
  }
}
