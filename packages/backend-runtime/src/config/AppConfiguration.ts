import { EnvParser } from './EnvParser';
import {
  DEFAULT_AUDIT_LOG_RETENTION_DAYS,
  DEFAULT_BACKGROUND_TASK_RUN_RETENTION_DAYS,
  DEFAULT_CHECK_CUSTOMJS_ENABLED,
  DEFAULT_CHECK_CUSTOMJS_MAX_CPU_MS,
  DEFAULT_CHECK_CUSTOMJS_MAX_FETCHES,
  DEFAULT_CHECK_CUSTOMJS_MAX_SCRIPT_BYTES,
  DEFAULT_CHECK_CUSTOMJS_MEMORY_MB,
  DEFAULT_CHECK_RETENTION_DAYS,
  DEFAULT_CHECK_TIMEOUT_SECONDS,
  DEFAULT_DEBUG_MODE,
  DEFAULT_IMPORT_CLAIM_STALE_SECONDS,
  DEFAULT_MAX_DEPLOY_KEYS_PER_REPO,
  DEFAULT_MAX_EXPORT_BYTES,
  DEFAULT_MAX_ASSETS_PER_RELEASE,
  DEFAULT_MAX_ASSET_BYTES,
  DEFAULT_MAX_CARDS_PER_COLUMN,
  DEFAULT_MAX_CHECKS_PER_SHA,
  DEFAULT_MAX_COLUMNS_PER_PROJECT,
  DEFAULT_MAX_DISCUSSIONS_PER_REPO,
  DEFAULT_MAX_IMPORT_BYTES,
  DEFAULT_MAX_IMPORT_REFS,
  DEFAULT_MAX_MIRROR_FAILURES,
  DEFAULT_MAX_PROJECTS_PER_REPO,
  DEFAULT_MAX_RELEASES_PER_REPO,
  DEFAULT_MAX_WIKI_BODY_BYTES,
  DEFAULT_MAX_WIKI_PAGES_PER_REPO,
  DEFAULT_SITE_URL,
} from './ConfigurationDefaults';

import { AuthConfig } from './sections/AuthConfig';
import { CommandCodeLimits } from './sections/CommandCodeLimits';
import { GitLimits } from './sections/GitLimits';
import { RealtimeLimits } from './sections/RealtimeLimits';
import { RepoLimits } from './sections/RepoLimits';
import { RouterLimits } from './sections/RouterLimits';
import { WebhookLimits } from './sections/WebhookLimits';

/**
 * Injectable instance view over Agent-Router environment configuration.
 *
 * Composed of focused section objects (`RepoLimits`, `GitLimits`,
 * `WebhookLimits`, `RealtimeLimits`, `AuthConfig`) so the god-file stays a
 * thin facade. `ConfigurationManager` statics delegate here for backward
 * compatibility. New code should accept `AppConfiguration` via constructor
 * injection so env parsing is stubbable.
 */
class AppConfiguration {
  private readonly repos: RepoLimits;
  private readonly git: GitLimits;
  private readonly webhooks: WebhookLimits;
  private readonly realtime: RealtimeLimits;
  private readonly auth: AuthConfig;
  private readonly router: RouterLimits;
  private readonly commandCode: CommandCodeLimits;

  constructor(private readonly env: unknown) {
    this.repos = new RepoLimits(env);
    this.git = new GitLimits(env);
    this.webhooks = new WebhookLimits(env);
    this.realtime = new RealtimeLimits(env);
    this.auth = new AuthConfig(env);
    this.router = new RouterLimits(env);
    this.commandCode = new CommandCodeLimits(env);
  }

  public static fromEnv(env: unknown): AppConfiguration {
    return new AppConfiguration(env);
  }

  public get repo(): RepoLimits {
    return this.repos;
  }

  public get gitLimits(): GitLimits {
    return this.git;
  }

  public get webhook(): WebhookLimits {
    return this.webhooks;
  }

  public get realtimeLimits(): RealtimeLimits {
    return this.realtime;
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

  public getMaxReposPerUser(): number {
    return this.repos.getMaxReposPerUser();
  }

  public getMaxTokensPerUser(): number {
    return this.repos.getMaxTokensPerUser();
  }

  public getMaxTokenExpiryDays(): number {
    return this.repos.getMaxTokenExpiryDays();
  }

  public getMaxPackObjects(): number {
    return this.git.getMaxPackObjects();
  }

  public getGitCacheTtlSeconds(): number {
    return this.git.getGitCacheTtlSeconds();
  }

  public getMaxFetchWants(): number {
    return this.git.getMaxFetchWants();
  }

  public getMaxFetchHaves(): number {
    return this.git.getMaxFetchHaves();
  }

  public getMaxPushCommands(): number {
    return this.git.getMaxPushCommands();
  }

  public getMaxPackBytes(): number {
    return this.git.getMaxPackBytes();
  }

  public getMaxFetchBodyBytes(): number {
    return this.git.getMaxFetchBodyBytes();
  }

  public getMaxMergeDiffFiles(): number {
    return this.git.getMaxMergeDiffFiles();
  }

  public getMaxFileBytes(): number {
    return this.git.getMaxFileBytes();
  }

  public getMaxRulesPerRepo(): number {
    return this.repos.getMaxRulesPerRepo();
  }

  public getTaskRunRetentionDays(): number {
    return EnvParser.positiveInt(this.env, 'BACKGROUND_TASK_RUN_RETENTION_DAYS', DEFAULT_BACKGROUND_TASK_RUN_RETENTION_DAYS);
  }

  public getAuditLogRetentionDays(): number {
    return EnvParser.positiveInt(this.env, 'AUDIT_LOG_RETENTION_DAYS', DEFAULT_AUDIT_LOG_RETENTION_DAYS);
  }

  public getMaxHooksPerRepo(): number {
    return this.webhooks.getMaxHooksPerRepo();
  }

  public getWebhookDeliveryRetentionDays(): number {
    return this.webhooks.getDeliveryRetentionDays();
  }

  public getWebhookMaxAttempts(): number {
    return this.webhooks.getMaxAttempts();
  }

  public getWebhookTimeoutMs(): number {
    return this.webhooks.getTimeoutMs();
  }

  public getWebhookMaxConsecutiveFailures(): number {
    return this.webhooks.getMaxConsecutiveFailures();
  }

  public getWebhookMaxPayloadBytes(): number {
    return this.webhooks.getMaxPayloadBytes();
  }

  public getMaxReleasesPerRepo(): number {
    return EnvParser.positiveInt(this.env, 'MAX_RELEASES_PER_REPO', DEFAULT_MAX_RELEASES_PER_REPO);
  }

  public getMaxAssetsPerRelease(): number {
    return EnvParser.positiveInt(this.env, 'MAX_ASSETS_PER_RELEASE', DEFAULT_MAX_ASSETS_PER_RELEASE);
  }

  public getMaxAssetBytes(): number {
    return EnvParser.positiveInt(this.env, 'MAX_ASSET_BYTES', DEFAULT_MAX_ASSET_BYTES);
  }

  public getMaxProjectsPerRepo(): number {
    return EnvParser.positiveInt(this.env, 'MAX_PROJECTS_PER_REPO', DEFAULT_MAX_PROJECTS_PER_REPO);
  }

  public getMaxColumnsPerProject(): number {
    return EnvParser.positiveInt(this.env, 'MAX_COLUMNS_PER_PROJECT', DEFAULT_MAX_COLUMNS_PER_PROJECT);
  }

  public getMaxCardsPerColumn(): number {
    return EnvParser.positiveInt(this.env, 'MAX_CARDS_PER_COLUMN', DEFAULT_MAX_CARDS_PER_COLUMN);
  }

  public getMaxDiscussionsPerRepo(): number {
    return EnvParser.positiveInt(this.env, 'MAX_DISCUSSIONS_PER_REPO', DEFAULT_MAX_DISCUSSIONS_PER_REPO);
  }

  public getMaxWikiPagesPerRepo(): number {
    return EnvParser.positiveInt(this.env, 'MAX_WIKI_PAGES_PER_REPO', DEFAULT_MAX_WIKI_PAGES_PER_REPO);
  }

  public getMaxWikiBodyBytes(): number {
    return EnvParser.positiveInt(this.env, 'MAX_WIKI_BODY_BYTES', DEFAULT_MAX_WIKI_BODY_BYTES);
  }

  public getMaxSnippetsPerUser(): number {
    return this.repos.getMaxSnippetsPerUser();
  }

  public getMaxFilesPerSnippet(): number {
    return this.repos.getMaxFilesPerSnippet();
  }

  public getMaxSnippetBytes(): number {
    return this.repos.getMaxSnippetBytes();
  }

  public getMaxTeamsPerOrg(): number {
    return this.repos.getMaxTeamsPerOrg();
  }

  public getMaxTeamMembers(): number {
    return this.repos.getMaxTeamMembers();
  }

  public getMaxTeamGrants(): number {
    return this.repos.getMaxTeamGrants();
  }

  public getMaxImportBytes(): number {
    return EnvParser.positiveInt(this.env, 'MAX_IMPORT_BYTES', DEFAULT_MAX_IMPORT_BYTES);
  }

  public getMaxImportRefs(): number {
    return EnvParser.positiveInt(this.env, 'MAX_IMPORT_REFS', DEFAULT_MAX_IMPORT_REFS);
  }

  public getMaxExportBytes(): number {
    return EnvParser.positiveInt(this.env, 'MAX_EXPORT_BYTES', DEFAULT_MAX_EXPORT_BYTES);
  }

  public getMaxDeployKeysPerRepo(): number {
    return EnvParser.positiveInt(this.env, 'MAX_DEPLOY_KEYS_PER_REPO', DEFAULT_MAX_DEPLOY_KEYS_PER_REPO);
  }

  public getMaxTokenRepoGrants(): number {
    return this.repos.getMaxTokenRepoGrants();
  }

  public getMaxMirrorFailures(): number {
    return EnvParser.positiveInt(this.env, 'MAX_MIRROR_FAILURES', DEFAULT_MAX_MIRROR_FAILURES);
  }

  public getImportClaimStaleSeconds(): number {
    return EnvParser.positiveInt(this.env, 'IMPORT_CLAIM_STALE_SECONDS', DEFAULT_IMPORT_CLAIM_STALE_SECONDS);
  }

  public getMaxChecksPerSha(): number {
    return EnvParser.positiveInt(this.env, 'MAX_CHECKS_PER_SHA', DEFAULT_MAX_CHECKS_PER_SHA);
  }

  public getCheckTimeoutSeconds(): number {
    return EnvParser.positiveInt(this.env, 'CHECK_TIMEOUT_SECONDS', DEFAULT_CHECK_TIMEOUT_SECONDS);
  }

  public getCheckRetentionDays(): number {
    return EnvParser.positiveInt(this.env, 'CHECK_RETENTION_DAYS', DEFAULT_CHECK_RETENTION_DAYS);
  }

  public isCheckCustomJsEnabled(): boolean {
    return EnvParser.boolean(this.env, 'CHECK_CUSTOMJS_ENABLED', DEFAULT_CHECK_CUSTOMJS_ENABLED);
  }

  public getCheckCustomJsMaxCpuMs(): number {
    return EnvParser.positiveInt(this.env, 'CHECK_CUSTOMJS_MAX_CPU_MS', DEFAULT_CHECK_CUSTOMJS_MAX_CPU_MS);
  }

  public getCheckCustomJsMaxScriptBytes(): number {
    return EnvParser.positiveInt(this.env, 'CHECK_CUSTOMJS_MAX_SCRIPT_BYTES', DEFAULT_CHECK_CUSTOMJS_MAX_SCRIPT_BYTES);
  }

  public getCheckCustomJsMaxFetches(): number {
    return EnvParser.positiveInt(this.env, 'CHECK_CUSTOMJS_MAX_FETCHES', DEFAULT_CHECK_CUSTOMJS_MAX_FETCHES);
  }

  public getCheckCustomJsMemoryMb(): number {
    return EnvParser.positiveInt(this.env, 'CHECK_CUSTOMJS_MEMORY_MB', DEFAULT_CHECK_CUSTOMJS_MEMORY_MB);
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

  public isRealtimeEnabled(): boolean {
    return this.realtime.isEnabled();
  }

  public getRealtimeTicketTtlSeconds(): number {
    return this.realtime.getTicketTtlSeconds();
  }

  public getRealtimeMaxConnPerRepoShard(): number {
    return this.realtime.getMaxConnPerRepoShard();
  }

  public getRealtimeMaxConnPerInboxShard(): number {
    return this.realtime.getMaxConnPerInboxShard();
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

  public getCommandCodeNonStreamIdleMs(): number {
    return this.commandCode.getNonStreamIdleMs();
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
