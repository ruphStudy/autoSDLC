import {
  ConflictException,
  HttpException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import {
  ProjectDeliveryError,
  ProjectDeliveryErrorCode,
} from './project-delivery.error';

export function mapProjectDeliveryErrorToHttpException(
  error: ProjectDeliveryError,
): HttpException {
  const body = { code: error.code, message: error.message };

  switch (error.code) {
    case ProjectDeliveryErrorCode.DELIVERY_NOT_FOUND:
      return new NotFoundException(body);

    case ProjectDeliveryErrorCode.UNKNOWN_ERROR:
      return new InternalServerErrorException(body);

    // Every other code represents a well-understood reason the Project
    // cannot be completed right now (a state/precondition conflict), never a
    // client input error.
    default:
      return new ConflictException(body);
  }
}
