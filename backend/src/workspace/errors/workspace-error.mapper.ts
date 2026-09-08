import {
  BadRequestException,
  ConflictException,
  GatewayTimeoutException,
  HttpException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { GitError, GitErrorCode } from './git.error';

// Same shape/spirit as mapApprovalErrorToHttpException / mapJobErrorToHttpException:
// a machine-readable `code` alongside a human message, never the raw Git
// stderr/stdout.
export function mapGitErrorToHttpException(error: GitError): HttpException {
  const body = { code: error.code, message: error.message };

  switch (error.code) {
    case GitErrorCode.PATH_VIOLATION:
    case GitErrorCode.INVALID_REMOTE:
      return new BadRequestException(body);

    case GitErrorCode.COMMAND_TIMEOUT:
      return new GatewayTimeoutException(body);

    case GitErrorCode.DIRTY_WORKTREE:
    case GitErrorCode.WORKSPACE_NOT_READY:
    case GitErrorCode.AUTHENTICATION_FAILED:
      return new ConflictException(body);

    case GitErrorCode.GIT_NOT_AVAILABLE:
    case GitErrorCode.NOT_A_REPOSITORY:
    case GitErrorCode.CLONE_FAILED:
    case GitErrorCode.BRANCH_FAILED:
    case GitErrorCode.COMMIT_FAILED:
    case GitErrorCode.WORKSPACE_INVALID:
    case GitErrorCode.COMMAND_FAILED:
    default:
      return new UnprocessableEntityException(body);
  }
}
