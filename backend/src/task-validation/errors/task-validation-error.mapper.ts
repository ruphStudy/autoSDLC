import {
  ConflictException,
  HttpException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import {
  TaskValidationError,
  TaskValidationErrorCode,
} from './task-validation.error';

export function mapTaskValidationErrorToHttpException(
  error: TaskValidationError,
): HttpException {
  const body = { code: error.code, message: error.message };

  switch (error.code) {
    case TaskValidationErrorCode.TASK_NOT_FOUND:
    case TaskValidationErrorCode.VALIDATION_NOT_FOUND:
      return new NotFoundException(body);

    case TaskValidationErrorCode.UNKNOWN_ERROR:
      return new InternalServerErrorException(body);

    default:
      return new ConflictException(body);
  }
}
