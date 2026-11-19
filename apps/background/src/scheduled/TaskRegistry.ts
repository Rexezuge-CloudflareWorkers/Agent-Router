import { TimestampUtil } from '@rexezuge/shared';
import { Tokens, createRequestScope } from '@agent-router/backend-services/composition';
import { createLogger } from '@rexezuge/runtime';
import { ConfigurationManager } from '@agent-router/backend-runtime/config';
import { BaseScheduledTask } from './IScheduledTask';
import type { ScheduledTask } from './IScheduledTask';

const logger = createLogger('CronTasks');

class GatewayKeyPruningTask extends BaseScheduledTask {
  public readonly name = 'GatewayKeyPruningTask';
  public readonly phase: 1 | 2 = 1;

  protected async handleScheduledTask(env: Env): Promise<void> {
    const now = TimestampUtil.getCurrentUnixTimestampInSeconds();
    const pruned = await createRequestScope(env)
      .get(Tokens.GatewayKeyService)
      .pruneExpired(now, 500)
      .catch(() => 0);
    if (pruned > 0) logger.info(`Pruned ${pruned} expired gateway keys`);
  }
}

class UsageResetTask extends BaseScheduledTask {
  public readonly name = 'UsageResetTask';
  public readonly phase: 1 | 2 = 1;

  protected async handleScheduledTask(env: Env): Promise<void> {
    const scope = createRequestScope(env);
    const dao = await scope.get(Tokens.ProviderKeyDAO)();
    const reset = await dao.resetDueKeys(TimestampUtil.getCurrentUnixTimestampInSeconds(), 500).catch(() => 0);
    if (reset > 0) logger.info(`Reset usage for ${reset} provider keys`);
  }
}

class KeyHealthTask extends BaseScheduledTask {
  public readonly name = 'KeyHealthTask';
  public readonly phase: 1 | 2 = 2;

  protected async handleScheduledTask(env: Env): Promise<void> {
    const scope = createRequestScope(env);
    const dao = await scope.get(Tokens.ProviderKeyDAO)();
    const threshold = ConfigurationManager.router.getKeyMaxConsecutiveFailures(env);
    const disabled = await dao.disableFailing(threshold, TimestampUtil.getCurrentUnixTimestampInSeconds(), 200).catch(() => 0);
    if (disabled > 0) logger.info(`Disabled ${disabled} failing provider keys`);
  }
}

class UsagePruneTask extends BaseScheduledTask {
  public readonly name = 'UsagePruneTask';
  public readonly phase: 1 | 2 = 2;

  protected async handleScheduledTask(env: Env): Promise<void> {
    const retentionDays = ConfigurationManager.router.getUsageRetentionDays(env);
    const cutoff = TimestampUtil.getCurrentUnixTimestampInSeconds() - retentionDays * 86_400;
    const pruned = await createRequestScope(env)
      .get(Tokens.UsageService)
      .pruneOlderThan(cutoff, 500)
      .catch(() => 0);
    if (pruned > 0) logger.info(`Pruned ${pruned} usage ledger rows`);
  }
}

class CodexTokenRefreshTask extends BaseScheduledTask {
  public readonly name = 'CodexTokenRefreshTask';
  public readonly phase: 1 | 2 = 1;

  protected async handleScheduledTask(env: Env): Promise<void> {
    const scope = createRequestScope(env);
    const batchSize = ConfigurationManager.router.getCodexRefreshBatchSize(env);
    const { refreshed, revoked } = await scope
      .get(Tokens.CodexTokenService)
      .refreshExpiring(batchSize)
      .catch(() => ({ refreshed: 0, revoked: 0 }));
    if (refreshed > 0) logger.info(`Refreshed ${refreshed} Codex OAuth tokens`);
    if (revoked > 0) logger.info(`${revoked} Codex OAuth keys need reconnection`);
    const sessionDAO = await scope.get(Tokens.CodexDeviceSessionDAO)();
    const pruned = await sessionDAO.deleteExpiredOrConsumed(TimestampUtil.getCurrentUnixTimestampInSeconds(), 500).catch(() => 0);
    if (pruned > 0) logger.info(`Pruned ${pruned} Codex device sessions`);
  }
}

const CRON_TASK_DEFINITIONS: ScheduledTask[] = [
  new GatewayKeyPruningTask(),
  new UsageResetTask(),
  new CodexTokenRefreshTask(),
  new KeyHealthTask(),
  new UsagePruneTask(),
];

async function runScheduledTasks(env: Env, cron: string, scheduledTime: number): Promise<void> {
  logger.info(`Running scheduled tasks for ${cron} at ${scheduledTime}`);
  const phase1 = CRON_TASK_DEFINITIONS.filter((t) => t.phase === 1);
  const phase2 = CRON_TASK_DEFINITIONS.filter((t) => t.phase === 2);
  await Promise.all(phase1.map((t) => t.run(env).catch((error: unknown) => logger.error(`Task ${t.name} failed`, error))));
  await Promise.all(phase2.map((t) => t.run(env).catch((error: unknown) => logger.error(`Task ${t.name} failed`, error))));
}

export {
  CRON_TASK_DEFINITIONS,
  runScheduledTasks,
  GatewayKeyPruningTask,
  UsageResetTask,
  CodexTokenRefreshTask,
  KeyHealthTask,
  UsagePruneTask,
};
export type { ScheduledTask } from './IScheduledTask';
