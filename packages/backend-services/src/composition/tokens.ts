import type {
  CodexDeviceSessionDAO,
  CommandCodeKeyStateDAO,
  GatewayKeyDAO,
  GatewayKeyPeakPreferenceDAO,
  ProviderDAO,
  ProviderKeyDAO,
  UsageLedgerDAO,
  UserDAO,
  WebSearchSettingsDAO,
} from '@agent-router/backend-data/dao';
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
import type { WebSearchRoutingService, WebSearchSettingsService } from '../search';
import type { UsageService } from '../usage/UsageService';
import type { UserService } from '../user/UserService';

const Tokens = {
  AppConfig: Symbol('AppConfig') as Token<AppConfiguration>,
  UserDAO: Symbol('UserDAO') as Token<() => Promise<UserDAO>>,
  GatewayKeyDAO: Symbol('GatewayKeyDAO') as Token<() => Promise<GatewayKeyDAO>>,
  GatewayKeyPeakPreferenceDAO: Symbol('GatewayKeyPeakPreferenceDAO') as Token<() => Promise<GatewayKeyPeakPreferenceDAO>>,
  ProviderDAO: Symbol('ProviderDAO') as Token<() => Promise<ProviderDAO>>,
  ProviderKeyDAO: Symbol('ProviderKeyDAO') as Token<() => Promise<ProviderKeyDAO>>,
  CodexDeviceSessionDAO: Symbol('CodexDeviceSessionDAO') as Token<() => Promise<CodexDeviceSessionDAO>>,
  CommandCodeKeyStateDAO: Symbol('CommandCodeKeyStateDAO') as Token<() => Promise<CommandCodeKeyStateDAO>>,
  UsageLedgerDAO: Symbol('UsageLedgerDAO') as Token<() => Promise<UsageLedgerDAO>>,
  WebSearchSettingsDAO: Symbol('WebSearchSettingsDAO') as Token<() => Promise<WebSearchSettingsDAO>>,
  AccessAuthService: Symbol('AccessAuthService') as Token<AccessAuthService>,
  CodexOAuthService: Symbol('CodexOAuthService') as Token<CodexOAuthService>,
  CodexTokenService: Symbol('CodexTokenService') as Token<CodexTokenService>,
  CommandCodeService: Symbol('CommandCodeService') as Token<CommandCodeService>,
  GatewayKeyService: Symbol('GatewayKeyService') as Token<GatewayKeyService>,
  ProviderService: Symbol('ProviderService') as Token<ProviderService>,
  ProviderKeyService: Symbol('ProviderKeyService') as Token<ProviderKeyService>,
  RouterService: Symbol('RouterService') as Token<RouterService>,
  WebSearchRoutingService: Symbol('WebSearchRoutingService') as Token<WebSearchRoutingService>,
  WebSearchSettingsService: Symbol('WebSearchSettingsService') as Token<WebSearchSettingsService>,
  UsageService: Symbol('UsageService') as Token<UsageService>,
  UserService: Symbol('UserService') as Token<UserService>,
} satisfies Record<string, Token<unknown>>;

export { Tokens };
