import {
  BadRequestException,
  ConflictException,
  HttpException,
} from '@nestjs/common';
import { JobError, JobErrorCode } from './job.error';

export function mapJobErrorToHttpException(error: JobError): HttpException {
  const body = { code: error.code, message: error.message };

  switch (error.code) {
    case JobErrorCode.INVALID_PAYLOAD:
    case JobErrorCode.PAYLOAD_TOO_LARGE:
    case JobErrorCode.RESULT_TOO_LARGE:
      return new BadRequestException(body);

    case JobErrorCode.IDEMPOTENCY_CONFLICT:
    case JobErrorCode.NOT_CANCELLABLE:
    case JobErrorCode.UNKNOWN_TYPE:
    default:
      return new ConflictException(body);
  }
}
