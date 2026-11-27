import type { Context, Next } from 'hono';

type HeaderContext = Context<{ Bindings: Env; Variables: { AuthenticatedUserEmailAddress: string } }>;

const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Origin-Agent-Cluster': '?1',
};

// Paths carrying bearer secrets — never allow caching of their responses.
// Exact prefix matching (not substring) so a future `/hooks/providers/`-like
// path cannot accidentally inherit `no-store`, and secret routes cannot be
// missed.
function isSensitiveJsonPath(pathname: string): boolean {
  return (
    pathname === '/user/gateway-keys' ||
    pathname.startsWith('/user/gateway-keys/') ||
    pathname === '/user/providers' ||
    pathname.startsWith('/user/providers/') ||
    pathname === '/user/search-providers' ||
    pathname.startsWith('/user/search-providers/') ||
    pathname === '/user/settings/web-search'
  );
}

/**
Baseline security headers for API JSON responses and the SPA shell.
The SPA needs inline scripts/styles, so CSP stays permissive-but-bounded
(`frame-ancestors 'none'` blocks clickjacking without breaking Vite).
*/
function applySecurityHeaders(c: HeaderContext): void {
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    c.header(key, value);
  }
  const contentType = c.res.headers.get('content-type') ?? '';
  if (contentType.includes('text/html')) {
    c.header(
      'Content-Security-Policy',
      "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; frame-ancestors 'none'; base-uri 'self'",
    );
  }
  // Bearer-secret JSON (PATs, hook secrets, realtime tickets) must never be
  // cached by browsers or CDNs.
  try {
    const pathname = new URL(c.req.url).pathname;
    if (isSensitiveJsonPath(pathname)) {
      c.header('Cache-Control', 'no-store');
    }
  } catch {
    // URL parsing must never fail the request.
  }
  // HSTS only over HTTPS — sending it over plain HTTP risks local pinning
  // and is ignored by browsers anyway.
  try {
    if (new URL(c.req.url).protocol === 'https:') {
      c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
  } catch {
    // URL parsing must never fail the request.
  }
}

function securityHeaders(): (c: HeaderContext, next: Next) => Promise<Response | void> {
  // eslint-disable-next-line unicorn/consistent-function-scoping
  return async (c: HeaderContext, next: Next): Promise<Response | void> => {
    await next();
    try {
      applySecurityHeaders(c);
    } catch {
      // Headers must never fail the request.
    }
  };
}

export { securityHeaders, SECURITY_HEADERS, isSensitiveJsonPath, applySecurityHeaders };
