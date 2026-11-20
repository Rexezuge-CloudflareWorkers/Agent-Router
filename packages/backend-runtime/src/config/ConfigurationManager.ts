import { AppConfiguration } from './AppConfiguration';

/**
Thin backward-compatible facade over `AppConfiguration` for the scheduler and
auth strategy call sites, which only have a raw `env`. New code should inject
`AppConfiguration` directly.
*/
class ConfigurationManager {
  public static readonly auth = {
    isDemoMode: (env: unknown): boolean => AppConfiguration.fromEnv(env).isDemoMode(),
    getEnvironment: (env: unknown): string => AppConfiguration.fromEnv(env).getEnvironment(),
    isBypassAllowed: (env: unknown): boolean => AppConfiguration.fromEnv(env).isBypassAllowed(),
  };

  public static readonly router = {
    getKeyMaxConsecutiveFailures: (env: unknown): number => AppConfiguration.fromEnv(env).getKeyMaxConsecutiveFailures(),
    getUsageRetentionDays: (env: unknown): number => AppConfiguration.fromEnv(env).getUsageRetentionDays(),
    getCodexRefreshBatchSize: (env: unknown): number => AppConfiguration.fromEnv(env).getCodexRefreshBatchSize(),
  };
}

export { ConfigurationManager };
