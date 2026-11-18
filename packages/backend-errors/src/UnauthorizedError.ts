import { ErrorCode, ServiceError } from './IServiceError';

class UnauthorizedError extends ServiceError {
  constructor(message: string = 'Authentication is required and has failed or has not yet been provided.') {
    super(message);
  }

  public getErrorCode(): ErrorCode {
    return 401;
  }

  public getErrorType(): string {
    return 'Unauthorized';
  }

  public getErrorMessage(): string {
    return this.message;
  }
}

export { UnauthorizedError };
