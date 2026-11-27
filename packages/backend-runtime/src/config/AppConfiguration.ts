import { AppConfiguration as BaseAppConfiguration, EnvParser } from '@rexezuge/runtime';
import { DEFAULT_DEBUG_MODE, DEFAULT_SITE_URL } from './ConfigurationDefaults';
import { AuthConfig } from './sections/AuthConfig';
import { CommandCodeLimits } from './sections/CommandCodeLimits';
import { RouterLimits } from './sections/RouterLimits';

/**
Injectable instance view over Agent-Router environment configuration.

Composed of the sections the gateway actually uses — `RouterLimits`,
`CommandCodeLimits`, `AuthConfig` — so env parsing stays stubbable and a new
knob lands in one section rather than this file. `ConfigurationManager` statics
delegate here for the scheduler's call sites.
*/
class AppConfiguration extends BaseAppConfiguration {
  private readonly auth: AuthConfig;
  private readonly router: RouterLimits;
  private readonly commandCode: CommandCodeLimits;

  constructor(env: unknown) {
    super(env);
    this.auth = new AuthConfig(env);
    this.router = new RouterLimits(env);
    this.commandCode = new CommandCodeLimits(env);
  }

  public get routerLimits(): RouterLimits {
    return this.router;
  }

  public get commandCodeLimits(): CommandCodeLimits {
    return this.commandCode;
  }

  public get authConfig(): AuthConfig {
    return this.auth;
  }

  public getDebugMode(): boolean {
    return EnvParser.boolean(this.env, 'DEBUG_MODE', DEFAULT_DEBUG_MODE);
  }

  public getSiteUrl(): string {
    let url = EnvParser.string(this.env, 'SITE_URL', DEFAULT_SITE_URL);
    while (url.endsWith('/')) url = url.slice(0, -1);
    return url;
  }

  public isDemoMode(): boolean {
    return this.auth.isDemoMode();
  }

  public getEnvironment(): string {
    return this.auth.getEnvironment();
  }

  public isBypassAllowed(): boolean {
    return this.auth.isBypassAllowed();
  }

  public getDevAuthEmail(): string | null {
    return this.auth.getDevAuthEmail();
  }

  public getDemoUserEmail(): string | null {
    return this.auth.getDemoUserEmail();
  }

  public getTeamDomain(): string | null {
    return this.auth.getTeamDomain();
  }

  public getPolicyAud(): string | null {
    return this.auth.getPolicyAud();
  }

  public getMaxProvidersPerUser(): number {
    return this.router.getMaxProvidersPerUser();
  }

  public getMaxKeysPerProvider(): number {
    return this.router.getMaxKeysPerProvider();
  }

  public getMaxGatewayKeysPerUser(): number {
    return this.router.getMaxGatewayKeysPerUser();
  }

  public getMaxGatewayKeyExpiryDays(): number {
    return this.router.getMaxGatewayKeyExpiryDays();
  }

  public getCommandCodeProtocolVersion(): string {
    return this.commandCode.getProtocolVersion();
  }

  public getCommandCodeDeviceProjectDir(): string {
    return this.commandCode.getDeviceProjectDir();
  }

  public getCommandCodeCliMode(): string {
    return this.commandCode.getCliMode();
  }

  public getCommandCodeCliSessionMode(): string {
    return this.commandCode.getCliSessionMode();
  }

  public isCommandCodeEmptySystemPlaceholderEnabled(): boolean {
    return this.commandCode.isEmptySystemPlaceholderEnabled();
  }

  public isCommandCodeZdrEnabled(): boolean {
    return this.commandCode.isZdrEnabled();
  }

  public getCommandCodeMaxBodyBytes(): number {
    return this.commandCode.getMaxBodyBytes();
  }

  public getCommandCodeTimeoutMs(): number {
    return this.commandCode.getTimeoutMs();
  }

  public getCommandCodeStreamIdleMs(): number {
    return this.commandCode.getStreamIdleMs();
  }

  public getCommandCodeStreamHeartbeatMs(): number {
    return this.commandCode.getStreamHeartbeatMs();
  }

  public getCommandCodeMaxToolImageMb(): number {
    return this.commandCode.getMaxToolImageMb();
  }

  public getCommandCodeModelsTtlMs(): number {
    return this.commandCode.getModelsTtlMs();
  }

  public getProxyTimeoutMs(): number {
    return this.router.getProxyTimeoutMs();
  }

  public getProxyMaxAttempts(): number {
    return this.router.getProxyMaxAttempts();
  }

  public getProxyMaxBodyBytes(): number {
    return this.router.getProxyMaxBodyBytes();
  }

  public getKeyCooldownBaseMs(): number {
    return this.router.getKeyCooldownBaseMs();
  }

  public getKeyMaxConsecutiveFailures(): number {
    return this.router.getKeyMaxConsecutiveFailures();
  }

  public getUsageRetentionDays(): number {
    return this.router.getUsageRetentionDays();
  }

  public getCodexOAuthStateExpiryMinutes(): number {
    return this.router.getCodexOAuthStateExpiryMinutes();
  }

  public getCodexAccessMinValidSeconds(): number {
    return this.router.getCodexAccessMinValidSeconds();
  }

  public getCodexRefreshBatchSize(): number {
    return this.router.getCodexRefreshBatchSize();
  }
}

export { AppConfiguration };
