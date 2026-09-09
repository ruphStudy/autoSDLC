import {
  ConflictException,
  HttpException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import {
  SprintExecutionError,
  SprintExecutionErrorCode,
} from './sprint-execution.error';

export function mapSprintExecutionErrorToHttpException(
  error: SprintExecutionError,
): HttpException {
  const body = { code: error.code, message: error.message };

  switch (error.code) {
    case SprintExecutionErrorCode.SPRINT_NOT_FOUND:
    case SprintExecutionErrorCode.EXECUTION_NOT_FOUND:
      return new NotFoundException(body);

    case SprintExecutionErrorCode.UNKNOWN_ERROR:
      return new InternalServerErrorException(body);

    default:
      return new ConflictException(body);
  }
}
