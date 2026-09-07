import {
  BadRequestException,
  GatewayTimeoutException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { mapPlanningErrorToHttpException } from './sprint-plan-error.mapper';
import {
  PlanningAIError,
  PlanningErrorCode,
} from '../../ai/planning/errors/planning-ai.error';

function error(code: PlanningErrorCode): PlanningAIError {
  return new PlanningAIError({
    code,
    message: 'raw provider detail that must never reach the client',
    provider: 'openai',
    retryable: false,
  });
}

describe('mapPlanningErrorToHttpException (sprint planning)', () => {
  it('maps TIMEOUT to 504', () => {
    expect(
      mapPlanningErrorToHttpException(error(PlanningErrorCode.TIMEOUT)),
    ).toBeInstanceOf(GatewayTimeoutException);
  });

  it.each([
    PlanningErrorCode.INVALID_STRUCTURED_RESPONSE,
    PlanningErrorCode.CONTENT_REFUSED,
    PlanningErrorCode.CONTEXT_LIMIT,
  ])('maps %s to 422', (code) => {
    expect(mapPlanningErrorToHttpException(error(code))).toBeInstanceOf(
      UnprocessableEntityException,
    );
  });

  it('maps INVALID_REQUEST to 400', () => {
    expect(
      mapPlanningErrorToHttpException(error(PlanningErrorCode.INVALID_REQUEST)),
    ).toBeInstanceOf(BadRequestException);
  });

  it.each([
    PlanningErrorCode.AUTHENTICATION_ERROR,
    PlanningErrorCode.CONFIGURATION_ERROR,
    PlanningErrorCode.RATE_LIMITED,
    PlanningErrorCode.PROVIDER_UNAVAILABLE,
    PlanningErrorCode.NETWORK_ERROR,
    PlanningErrorCode.UNKNOWN_PROVIDER_ERROR,
  ])('maps %s to 503', (code) => {
    expect(mapPlanningErrorToHttpException(error(code))).toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('never includes the raw provider error message in the response', () => {
    const httpError = mapPlanningErrorToHttpException(
      error(PlanningErrorCode.PROVIDER_UNAVAILABLE),
    );
    expect(JSON.stringify(httpError.getResponse())).not.toContain(
      'raw provider detail that must never reach the client',
    );
  });
});
