import {
  ConflictException,
  HttpException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import {
  SprintAcceptanceError,
  SprintAcceptanceErrorCode,
} from './sprint-acceptance.error';

export function mapSprintAcceptanceErrorToHttpException(
  error: SprintAcceptanceError,
): HttpException {
  const body = { code: error.code, message: error.message };

  switch (error.code) {
    case SprintAcceptanceErrorCode.SPRINT_NOT_FOUND:
    case SprintAcceptanceErrorCode.ACCEPTANCE_NOT_FOUND:
      return new NotFoundException(body);

    case SprintAcceptanceErrorCode.UNKNOWN_ERROR:
      return new InternalServerErrorException(body);

    default:
      return new ConflictException(body);
  }
}
