import { ServiceError } from './IServiceError';

class ExceededLimitError extends ServiceError {
  public override readonly retryable = true;

  constructor(message: string = 'Rate limit exceeded. Try again later.') {
    super(message);
  }

  public getErrorCode(): number {
    return 429;
  }

  public getErrorType(): string {
    return 'ExceededLimit';
  }

  public getErrorMessage(): string {
    return this.message;
  }
}

export { ExceededLimitError };
