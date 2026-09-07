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
 * Translates a normalized PlanningAIError into an HTTP-facing exception.
 * Never forwards `error.cause`/provider internals — only a safe, generic
 * message reaches the client; full detail is still in the server logs via
 * the PlanningAIProvider's own logging.
 */
export function mapPlanningErrorToHttpException(
  error: PlanningAIError,
): HttpException {
  switch (error.code) {
    case PlanningErrorCode.TIMEOUT:
      return new GatewayTimeoutException(
        'Analysis generation timed out. Please try again.',
      );

    case PlanningErrorCode.INVALID_STRUCTURED_RESPONSE:
    case PlanningErrorCode.CONTENT_REFUSED:
    case PlanningErrorCode.CONTEXT_LIMIT:
      return new UnprocessableEntityException(
        'Analysis generation did not produce a valid result. Please try again or adjust the project brief.',
      );

    case PlanningErrorCode.INVALID_REQUEST:
      return new BadRequestException(
        'Analysis generation request was invalid.',
      );

    case PlanningErrorCode.AUTHENTICATION_ERROR:
    case PlanningErrorCode.CONFIGURATION_ERROR:
    case PlanningErrorCode.RATE_LIMITED:
    case PlanningErrorCode.PROVIDER_UNAVAILABLE:
    case PlanningErrorCode.NETWORK_ERROR:
    case PlanningErrorCode.UNKNOWN_PROVIDER_ERROR:
    default:
      return new ServiceUnavailableException(
        'Analysis generation is temporarily unavailable. Please try again shortly.',
      );
  }
}
