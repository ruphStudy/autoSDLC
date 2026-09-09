import {
  BadRequestException,
  GatewayTimeoutException,
  HttpException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  PlanningAIError,
  PlanningErrorCode,
} from '../../ai/planning/errors/planning-ai.error';

// Same PlanningErrorCode -> HTTP status mapping as sprint-planning/
// project-analysis/architecture, with task-instruction-specific wording —
// kept as its own small function per the same stability-first reasoning
// (duplicating a handful of strings over a shared parameterized helper).
export function mapTaskInstructionPlanningErrorToHttpException(
  error: PlanningAIError,
): HttpException {
  switch (error.code) {
    case PlanningErrorCode.TIMEOUT:
      return new GatewayTimeoutException(
        'Task instruction generation timed out. Please try again.',
      );

    case PlanningErrorCode.INVALID_STRUCTURED_RESPONSE:
    case PlanningErrorCode.CONTENT_REFUSED:
    case PlanningErrorCode.CONTEXT_LIMIT:
      return new UnprocessableEntityException(
        'Task instruction generation did not produce a valid result. Please try again.',
      );

    case PlanningErrorCode.INVALID_REQUEST:
      return new BadRequestException(
        'Task instruction generation request was invalid.',
      );

    case PlanningErrorCode.AUTHENTICATION_ERROR:
    case PlanningErrorCode.CONFIGURATION_ERROR:
    case PlanningErrorCode.RATE_LIMITED:
    case PlanningErrorCode.PROVIDER_UNAVAILABLE:
    case PlanningErrorCode.NETWORK_ERROR:
    case PlanningErrorCode.UNKNOWN_PROVIDER_ERROR:
    default:
      return new ServiceUnavailableException(
        'Task instruction generation is temporarily unavailable. Please try again shortly.',
      );
  }
}
