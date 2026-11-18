import type {
  CodexDeviceSessionDAO,
  CommandCodeKeyStateDAO,
  GatewayKeyDAO,
  ProviderDAO,
  ProviderKeyDAO,
  UsageLedgerDAO,
  UserDAO,
} from '@agent-router/backend-data/dao';
import type { D1Queryable } from '@agent-router/backend-data/utils';
import type { Token } from '@agent-router/backend-runtime/di';
import type { AppConfiguration } from '@agent-router/backend-runtime/config';
import type { AccessAuthService } from '../auth/AccessAuthService';
import type { CodexOAuthService } from '../codex/CodexOAuthService';
import type { CodexTokenService } from '../codex/CodexTokenService';
import type { CommandCodeService } from '../commandcode/CommandCodeService';
import type { GatewayKeyService } from '../gateway/GatewayKeyService';
import type { ProviderService } from '../provider/ProviderService';
import type { ProviderKeyService } from '../provider/ProviderKeyService';
import type { RouterService } from '../router/RouterService';
import type { UsageService } from '../usage/UsageService';
import type { UserService } from '../user/UserService';

interface RequestScopeEnvShape {
  DB: D1Queryable;
  PROVIDER_KEYS_ENCRYPTION_SECRET?: { get(): Promise<string> };
  CODEX_OAUTH_ENCRYPTION_SECRET?: { get(): Promise<string> };
  COMMAND_CODE_FINGERPRINT_SALT?: { get(): Promise<string> };
}

interface RequestKeysShape {
  providerKeysKey: string;
  codexOAuthKey: string;
}

const Tokens = {
  Env: Symbol('Env') as Token<RequestScopeEnvShape>,
  Db: Symbol('Db') as Token<D1Queryable>,
  Keys: Symbol('Keys') as Token<() => Promise<RequestKeysShape>>,
  AppConfig: Symbol('AppConfig') as Token<AppConfiguration>,
  UserDAO: Symbol('UserDAO') as Token<() => Promise<UserDAO>>,
  GatewayKeyDAO: Symbol('GatewayKeyDAO') as Token<() => Promise<GatewayKeyDAO>>,
  ProviderDAO: Symbol('ProviderDAO') as Token<() => Promise<ProviderDAO>>,
  ProviderKeyDAO: Symbol('ProviderKeyDAO') as Token<() => Promise<ProviderKeyDAO>>,
  CodexDeviceSessionDAO: Symbol('CodexDeviceSessionDAO') as Token<() => Promise<CodexDeviceSessionDAO>>,
  CommandCodeKeyStateDAO: Symbol('CommandCodeKeyStateDAO') as Token<() => Promise<CommandCodeKeyStateDAO>>,
  UsageLedgerDAO: Symbol('UsageLedgerDAO') as Token<() => Promise<UsageLedgerDAO>>,
  AccessAuthService: Symbol('AccessAuthService') as Token<AccessAuthService>,
  CodexOAuthService: Symbol('CodexOAuthService') as Token<CodexOAuthService>,
  CodexTokenService: Symbol('CodexTokenService') as Token<CodexTokenService>,
  CommandCodeService: Symbol('CommandCodeService') as Token<CommandCodeService>,
  GatewayKeyService: Symbol('GatewayKeyService') as Token<GatewayKeyService>,
  ProviderService: Symbol('ProviderService') as Token<ProviderService>,
  ProviderKeyService: Symbol('ProviderKeyService') as Token<ProviderKeyService>,
  RouterService: Symbol('RouterService') as Token<RouterService>,
  UsageService: Symbol('UsageService') as Token<UsageService>,
  UserService: Symbol('UserService') as Token<UserService>,
} satisfies Record<string, Token<unknown>>;

export { Tokens };
