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
 * the sprint-planning domain. Same PlanningErrorCode -> HTTP status mapping
 * as project-analysis/architecture, with domain-specific wording — kept as
 * its own small function rather than a shared parameterized helper, per the
 * same stability-first reasoning used in Sprint 5 (duplicating a handful of
 * strings is lower-risk than refactoring already-stable, already-tested
 * mappers). Never forwards `error.cause`/provider internals to the client.
 */
export function mapPlanningErrorToHttpException(
  error: PlanningAIError,
): HttpException {
  switch (error.code) {
    case PlanningErrorCode.TIMEOUT:
      return new GatewayTimeoutException(
        'Sprint plan generation timed out. Please try again.',
      );

    case PlanningErrorCode.INVALID_STRUCTURED_RESPONSE:
    case PlanningErrorCode.CONTENT_REFUSED:
    case PlanningErrorCode.CONTEXT_LIMIT:
      return new UnprocessableEntityException(
        'Sprint plan generation did not produce a valid result. Please try again.',
      );

    case PlanningErrorCode.INVALID_REQUEST:
      return new BadRequestException(
        'Sprint plan generation request was invalid.',
      );

    case PlanningErrorCode.AUTHENTICATION_ERROR:
    case PlanningErrorCode.CONFIGURATION_ERROR:
    case PlanningErrorCode.RATE_LIMITED:
    case PlanningErrorCode.PROVIDER_UNAVAILABLE:
    case PlanningErrorCode.NETWORK_ERROR:
    case PlanningErrorCode.UNKNOWN_PROVIDER_ERROR:
    default:
      return new ServiceUnavailableException(
        'Sprint plan generation is temporarily unavailable. Please try again shortly.',
      );
  }
}
