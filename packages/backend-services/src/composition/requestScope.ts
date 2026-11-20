import {
  CodexDeviceSessionDAO,
  CommandCodeKeyStateDAO,
  GatewayKeyDAO,
  ProviderDAO,
  ProviderKeyDAO,
  UsageLedgerDAO,
  UserDAO,
} from '@agent-router/backend-data/dao';
import type { D1Queryable } from '@rexezuge/d1';
import { Container, memoizeAsync } from '@agent-router/backend-runtime/di';
import type { Token } from '@agent-router/backend-runtime/di';
import { AppConfiguration } from '@agent-router/backend-runtime/config';
import { AccessAuthService } from '@agent-router/backend-services/auth';
import { CodexOAuthService } from '@agent-router/backend-services/codex/CodexOAuthService';
import { CodexTokenService } from '@agent-router/backend-services/codex/CodexTokenService';
import { CommandCodeService } from '@agent-router/backend-services/commandcode/CommandCodeService';
import { GatewayKeyService } from '@agent-router/backend-services/gateway';
import { ProviderKeyService, ProviderService } from '@agent-router/backend-services/provider';
import { RouterService } from '@agent-router/backend-services/router';
import { UsageService } from '@agent-router/backend-services/usage';
import { UserService } from '@agent-router/backend-services/user';
import { Tokens } from './tokens';

interface RequestScopeEnv {
  DB: D1Queryable;
  PROVIDER_KEYS_ENCRYPTION_SECRET?: { get(): Promise<string> };
  CODEX_OAUTH_ENCRYPTION_SECRET?: { get(): Promise<string> };
  COMMAND_CODE_FINGERPRINT_SALT?: { get(): Promise<string> };
}

/**
Builds the per-request dependency container.

Services are bound lazily and memoized, so `scope.get(Tokens.RouterService)`
and `scope.get(Tokens.CodexTokenService)` return objects that share the same
`CodexTokenService` / `CommandCodeService` instances. That sharing is
load-bearing: `CodexTokenService` holds a single-flight refresh map, and two
instances would let concurrent proxy and token calls refresh the same OAuth key
in parallel.
*/
function createRequestScope(env: RequestScopeEnv): Container {
  const scope = new Container();
  const config = AppConfiguration.fromEnv(env);

  const providerKeysKey = memoizeAsync(() => {
    if (!env.PROVIDER_KEYS_ENCRYPTION_SECRET) throw new Error('PROVIDER_KEYS_ENCRYPTION_SECRET is not configured for this scope.');
    return env.PROVIDER_KEYS_ENCRYPTION_SECRET.get();
  });
  const codexOAuthKey = memoizeAsync(() => {
    if (!env.CODEX_OAUTH_ENCRYPTION_SECRET) throw new Error('CODEX_OAUTH_ENCRYPTION_SECRET is not configured for this scope.');
    return env.CODEX_OAUTH_ENCRYPTION_SECRET.get();
  });
  const commandCodeSalt = async (): Promise<string> => {
    return env.COMMAND_CODE_FINGERPRINT_SALT ? env.COMMAND_CODE_FINGERPRINT_SALT.get() : '';
  };

  const daoDefs: Array<[string, () => Promise<unknown>]> = [
    ['UserDAO', () => Promise.resolve(new UserDAO(env.DB))],
    ['GatewayKeyDAO', () => Promise.resolve(new GatewayKeyDAO(env.DB))],
    ['ProviderDAO', () => Promise.resolve(new ProviderDAO(env.DB))],
    ['ProviderKeyDAO', () => Promise.resolve(new ProviderKeyDAO(env.DB))],
    ['CodexDeviceSessionDAO', () => Promise.resolve(new CodexDeviceSessionDAO(env.DB))],
    ['CommandCodeKeyStateDAO', () => Promise.resolve(new CommandCodeKeyStateDAO(env.DB))],
    ['UsageLedgerDAO', () => Promise.resolve(new UsageLedgerDAO(env.DB))],
  ];
  const daoFactories = {} as Record<string, () => Promise<unknown>>;
  for (const [tokenName, create] of daoDefs) {
    const factory = memoizeAsync(create);
    daoFactories[tokenName] = factory;
    scope.bindValue((Tokens as Record<string, Token<unknown>>)[tokenName], factory);
  }
  const getDao = <T>(name: string): (() => Promise<T>) => daoFactories[name] as () => Promise<T>;

  const userDAO = getDao<UserDAO>('UserDAO');
  const gatewayKeyDAO = getDao<GatewayKeyDAO>('GatewayKeyDAO');
  const providerDAO = getDao<ProviderDAO>('ProviderDAO');
  const providerKeyDAO = getDao<ProviderKeyDAO>('ProviderKeyDAO');
  const codexSessionDAO = getDao<CodexDeviceSessionDAO>('CodexDeviceSessionDAO');
  const commandCodeKeyStateDAO = getDao<CommandCodeKeyStateDAO>('CommandCodeKeyStateDAO');
  const usageDAO = getDao<UsageLedgerDAO>('UsageLedgerDAO');

  scope.bind(Tokens.AccessAuthService, () => new AccessAuthService(env as never));
  scope.bind(Tokens.UserService, () => new UserService(env as never, { userDAO }));
  scope.bind(Tokens.GatewayKeyService, () => new GatewayKeyService(env as never, { gatewayKeyDAO, userDAO, config }));
  scope.bind(Tokens.ProviderService, () => new ProviderService(env as never, { providerDAO, config }));
  scope.bind(
    Tokens.ProviderKeyService,
    () => new ProviderKeyService(env as never, { providerDAO, providerKeyDAO, masterKey: providerKeysKey, config }),
  );
  scope.bind(
    Tokens.CodexOAuthService,
    () =>
      new CodexOAuthService(env as never, {
        providerDAO,
        providerKeyDAO,
        deviceSessionDAO: codexSessionDAO,
        masterKey: codexOAuthKey,
        config,
      }),
  );
  scope.bind(Tokens.CodexTokenService, () => new CodexTokenService(env as never, { providerKeyDAO, masterKey: codexOAuthKey, config }));
  scope.bind(
    Tokens.CommandCodeService,
    () => new CommandCodeService(env as never, { config, keyStateDAO: commandCodeKeyStateDAO, salt: commandCodeSalt }),
  );
  // The router shares the container's singletons rather than minting its own,
  // so Codex refresh single-flight and Command Code fingerprint caching are
  // process-wide, not per-service-instance.
  scope.bind(
    Tokens.RouterService,
    () =>
      new RouterService(env as never, {
        providerDAO,
        providerKeyDAO,
        usageDAO,
        masterKey: providerKeysKey,
        config,
        codexTokens: scope.get(Tokens.CodexTokenService),
        commandCode: scope.get(Tokens.CommandCodeService),
      }),
  );
  scope.bind(Tokens.UsageService, () => new UsageService(env as never, { usageDAO }));
  scope.bind(Tokens.AppConfig, () => config);

  return scope;
}

export { createRequestScope };
export type { RequestScopeEnv };
