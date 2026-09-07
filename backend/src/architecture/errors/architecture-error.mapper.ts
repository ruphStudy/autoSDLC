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

/**
 * Translates a normalized PlanningAIError into an HTTP-facing exception for
 * the architecture domain. Mirrors project-analysis's analysis-error.mapper
 * (same PlanningErrorCode -> HTTP status mapping) with architecture-specific
 * wording — kept as a separate small function rather than a shared
 * parameterized helper, since the two mappers' only real content is a
 * handful of user-facing strings and duplicating that is far lower-risk
 * than refactoring Sprint 4's already-stable, already-tested mapper.
 * Never forwards `error.cause`/provider internals to the client.
 */
export function mapPlanningErrorToHttpException(
  error: PlanningAIError,
): HttpException {
  switch (error.code) {
    case PlanningErrorCode.TIMEOUT:
      return new GatewayTimeoutException(
        'Architecture generation timed out. Please try again.',
      );

    case PlanningErrorCode.INVALID_STRUCTURED_RESPONSE:
    case PlanningErrorCode.CONTENT_REFUSED:
    case PlanningErrorCode.CONTEXT_LIMIT:
      return new UnprocessableEntityException(
        'Architecture generation did not produce a valid result. Please try again.',
      );

    case PlanningErrorCode.INVALID_REQUEST:
      return new BadRequestException(
        'Architecture generation request was invalid.',
      );

    case PlanningErrorCode.AUTHENTICATION_ERROR:
    case PlanningErrorCode.CONFIGURATION_ERROR:
    case PlanningErrorCode.RATE_LIMITED:
    case PlanningErrorCode.PROVIDER_UNAVAILABLE:
    case PlanningErrorCode.NETWORK_ERROR:
    case PlanningErrorCode.UNKNOWN_PROVIDER_ERROR:
    default:
      return new ServiceUnavailableException(
        'Architecture generation is temporarily unavailable. Please try again shortly.',
      );
  }
}
