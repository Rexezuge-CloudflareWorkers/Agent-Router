import { ErrorCode, ServiceError } from './IServiceError';

class ForbiddenError extends ServiceError {
  constructor(message: string = 'You do not have permission to perform this action.') {
    super(message);
  }

  public getErrorCode(): ErrorCode {
    return 403;
  }

  public getErrorType(): string {
    return 'Forbidden';
  }

  public getErrorMessage(): string {
    return this.message;
  }
}

export { ForbiddenError };
