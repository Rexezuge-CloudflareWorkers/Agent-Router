import { ErrorCode, ServiceError } from './IServiceError';

class NotFoundError extends ServiceError {
  constructor(message: string = 'The requested resource was not found.') {
    super(message);
  }

  public getErrorCode(): ErrorCode {
    return 404;
  }

  public getErrorType(): string {
    return 'NotFound';
  }

  public getErrorMessage(): string {
    return this.message;
  }
}

export { NotFoundError };
