import { describe, expect, it } from 'vitest';
import { Tokens, createRequestScope } from '@agent-router/backend-services/composition';

/**
Regression guard for the composition root: the router must share the same
`CodexTokenService` and `CommandCodeService` instances as their own tokens,
otherwise Codex refresh single-flight is defeated (two instances, two maps).
*/

const ENV = {
  DB: {},
  PROVIDER_KEYS_ENCRYPTION_SECRET: { get: async () => 'provider-master' },
  CODEX_OAUTH_ENCRYPTION_SECRET: { get: async () => 'codex-master' },
  COMMAND_CODE_FINGERPRINT_SALT: { get: async () => 'salt' },
  ENVIRONMENT: 'production',
} as never;

describe('createRequestScope', () => {
  it('memoizes each service to a single instance per scope', () => {
    const scope = createRequestScope(ENV);
    const keyA = scope.get(Tokens.GatewayKeyService);
    const keyB = scope.get(Tokens.GatewayKeyService);
    expect(keyA).toBe(keyB);
  });

  it('shares CodexTokenService and CommandCodeService with the router', () => {
    const scope = createRequestScope(ENV);
    const tokens = scope.get(Tokens.CodexTokenService);
    const commandCode = scope.get(Tokens.CommandCodeService);
    // Grab the router and inspect the deps it was handed.
    const router = scope.get(Tokens.RouterService) as unknown as {
      deps: { codexTokens: unknown; commandCode: unknown };
    };
    expect(router.deps.codexTokens).toBe(tokens);
    expect(router.deps.commandCode).toBe(commandCode);
  });

  it('resolves the same DAO factory instance for repeated lookups', () => {
    const scope = createRequestScope(ENV);
    const factoryA = scope.get(Tokens.ProviderKeyDAO);
    const factoryB = scope.get(Tokens.ProviderKeyDAO);
    expect(factoryA).toBe(factoryB);
  });
});
