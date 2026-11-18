import type { Context } from 'hono';
import { ServiceError } from '@agent-router/backend-errors';
import { getBackendStrings } from '@agent-router/shared/i18n';

type HonoContext = Context<{ Bindings: Env; Variables: { AuthenticatedUserEmailAddress: string } }>;

/**
Template Method base for Hono route handlers (Otter `IBaseRoute` pattern).
Subclasses implement `handleRequest`; the base owns error mapping so
handlers stop duplicating `catch(()=>null)` / status-code switches and
private-repo existence hiding stays consistent.

Backend `Message` stays English (translate display-side per Otter i18n
guidance); `getBackendStrings` is wired here so the shared backend locale
bundle is live code, not dead code.
*/
abstract class BaseRoute {
  protected abstract handleRequest(c: HonoContext): Promise<Response>;

  public async handle(c: HonoContext): Promise<Response> {
    try {
      return await this.handleRequest(c);
    } catch (error) {
      return BaseRoute.toErrorResponse(c, error);
    }
  }

  public static toErrorResponse(c: HonoContext, error: unknown): Response {
    if (error instanceof ServiceError) {
      const code = error.getErrorCode();
      const body = {
        error: error.getErrorType(),
        message: error.getErrorMessage(),
      };
      return Response.json(body, { status: code });
    }
    // Untyped errors are masked as 500; log the cause server-side only.
    console.error('Unhandled route error', error instanceof Error ? error.message : error);
    const locale = this.resolveLocale(c);
    const strings = getBackendStrings(locale);
    return Response.json({ error: 'InternalError', message: strings.common.internalError }, { status: 500 });
  }

  private static resolveLocale(c: HonoContext): string {
    try {
      const header = c.req.header('Accept-Language');
      if (!header) return 'en';
      const first = header.split(',', 1)[0]?.split(';', 1)[0]?.trim();
      return first && first.length > 0 ? first : 'en';
    } catch {
      return 'en';
    }
  }

  protected json(c: HonoContext, data: unknown, status = 200): Response {
    return c.json(data, status as 200);
  }

  protected fail(message: string, status = 400): Response {
    return Response.json({ error: message }, { status });
  }
}

export { BaseRoute };
export type { HonoContext };
