import {
  BadRequestException,
  ConflictException,
  HttpException,
} from '@nestjs/common';
import { ApprovalError, ApprovalErrorCode } from './approval.error';

// Translates a normalized ApprovalError into an HTTP-facing exception. The
// response body always carries the machine-readable `code` alongside the
// human message, so clients (and tests) can branch on the exact failure
// reason rather than parsing free text.
export function mapApprovalErrorToHttpException(
  error: ApprovalError,
): HttpException {
  const body = { code: error.code, message: error.message };

  switch (error.code) {
    case ApprovalErrorCode.CHANGES_COMMENT_REQUIRED:
      return new BadRequestException(body);

    case ApprovalErrorCode.STAGE_NOT_READY:
    case ApprovalErrorCode.CURRENT_VERSION_MISSING:
    case ApprovalErrorCode.PREREQUISITE_MISSING:
    case ApprovalErrorCode.VERSION_STALE:
    case ApprovalErrorCode.DEVELOPMENT_PREREQUISITES_MISSING:
    default:
      return new ConflictException(body);
  }
}
