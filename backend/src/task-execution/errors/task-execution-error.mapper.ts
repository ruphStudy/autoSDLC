import {
  ConflictException,
  HttpException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import {
  TaskExecutionError,
  TaskExecutionErrorCode,
} from './task-execution.error';

export function mapTaskExecutionErrorToHttpException(
  error: TaskExecutionError,
): HttpException {
  const body = { code: error.code, message: error.message };

  switch (error.code) {
    case TaskExecutionErrorCode.TASK_NOT_FOUND:
    case TaskExecutionErrorCode.EXECUTION_NOT_FOUND:
      return new NotFoundException(body);

    case TaskExecutionErrorCode.UNKNOWN_ERROR:
      return new InternalServerErrorException(body);

    // Every other code represents a well-understood reason the Task cannot
    // be run right now (a state/precondition conflict), never a client
    // input error.
    default:
      return new ConflictException(body);
  }
}
