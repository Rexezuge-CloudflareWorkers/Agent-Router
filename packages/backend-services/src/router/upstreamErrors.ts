import type { ProviderKind } from '@agent-router/shared';
import { BadRequestError, ServiceError } from '@rexezuge/errors';
import { extractHtmlPageText } from '@agent-router/provider-clients/upstream';

/**
A stream that stayed silent is a 504, not a bad client request. Keeping the
concrete class in the error taxonomy makes the proxy boundary expose it.
*/
class UpstreamIdleError extends ServiceError {
  constructor(message: string) {
    super(504, 'UpstreamIdle', message, { expose: true, retryable: true });
  }
}

/**
Maps a non-retryable upstream response body to a client-facing error.

The Codex backend answers failed auth/edge checks with its login HTML page
instead of JSON; surface the page copy plus whether an account was even linked,
rather than markup.
*/
function toUpstreamError(kind: ProviderKind, status: number, bodyText: string, lastError: string, accountRouted: boolean): BadRequestError {
  if (kind === 'OPENAI_CODEX' && /^\s*</.test(bodyText)) {
    const text = extractHtmlPageText(bodyText);
    const message = accountRouted
      ? `Codex backend returned a login page (status ${status}) even with a linked account — likely an access challenge from this network.`
      : `Codex backend returned a login page (status ${status}) and no ChatGPT account is linked to this key. Re-import the full auth JSON so the account id is stored, then retry.`;
    return new BadRequestError(`${message}${text ? ` Page: ${text}` : ''}`.slice(0, 400));
  }
  return new BadRequestError(lastError.slice(0, 300));
}

/**
Attaches the upstream HTTP status to an error so `errorResponse` can relay it.
*/
function withStatusCode(error: unknown, statusCode: number): unknown {
  (error as { statusCode?: number }).statusCode = statusCode;
  return error;
}

export { UpstreamIdleError, toUpstreamError, withStatusCode };
