import { ErrorCode, ServiceError } from './IServiceError';

class MethodNotAllowedError extends ServiceError {
  constructor(message: string = 'The requested method is not allowed for this resource.') {
    super(message);
  }

  public getErrorCode(): ErrorCode {
    return 405;
  }

  public getErrorType(): string {
    return 'MethodNotAllowed';
  }

  public getErrorMessage(): string {
    return this.message;
  }
}

export { MethodNotAllowedError };
