import {
  BadRequestException,
  ConflictException,
  GatewayTimeoutException,
  HttpException,
  HttpStatus,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { CodingAgentError, CodingAgentErrorCode } from './coding-agent.error';

// Same shape/spirit as mapGitErrorToHttpException / mapApprovalErrorToHttpException:
// a machine-readable `code` alongside a human message, never raw provider
// exception detail.
export function mapCodingAgentErrorToHttpException(
  error: CodingAgentError,
): HttpException {
  const body = { code: error.code, message: error.message };

  switch (error.code) {
    case CodingAgentErrorCode.INVALID_REQUEST:
      return new BadRequestException(body);

    case CodingAgentErrorCode.WORKSPACE_NOT_READY:
    case CodingAgentErrorCode.WORKSPACE_DIRTY:
      return new ConflictException(body);

    case CodingAgentErrorCode.RATE_LIMITED:
      return new HttpException(body, HttpStatus.TOO_MANY_REQUESTS);

    case CodingAgentErrorCode.TIMEOUT:
      return new GatewayTimeoutException(body);

    case CodingAgentErrorCode.PROVIDER_UNAVAILABLE:
      return new ServiceUnavailableException(body);

    case CodingAgentErrorCode.CONFIGURATION_ERROR:
    case CodingAgentErrorCode.AUTHENTICATION_ERROR:
    case CodingAgentErrorCode.CANCELLED:
    case CodingAgentErrorCode.PERMISSION_DENIED:
    case CodingAgentErrorCode.TOOL_ERROR:
    case CodingAgentErrorCode.COMMAND_FAILED:
    case CodingAgentErrorCode.MAX_TURNS_EXCEEDED:
    case CodingAgentErrorCode.UNKNOWN_PROVIDER_ERROR:
    default:
      return new UnprocessableEntityException(body);
  }
}
