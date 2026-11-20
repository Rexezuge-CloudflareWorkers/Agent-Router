import { createLogger } from '@rexezuge/runtime';
import type { Container } from '@agent-router/backend-runtime/di';

const logger = createLogger('CronTasks');

interface ScheduledTask {
  name: string;
  phase: 1 | 2;
  run: (env: Env) => Promise<void>;
}

/**
Builds the dependency container for one task run.

Tasks take this rather than calling `createRequestScope` directly so a unit
test can pass a fake container and assert which service methods ran, without
a real D1 binding.
*/
type ScopeFactory = (env: Env) => Container;

// Template Method: `run` is the invariant entrypoint (logging + delegation),
// subclasses implement `handleScheduledTask` with the phase-specific work.
abstract class BaseScheduledTask implements ScheduledTask {
  public abstract readonly name: string;
  public abstract readonly phase: 1 | 2;

  public run(env: Env): Promise<void> {
    return this.handle(env);
  }

  public async handle(env: Env): Promise<void> {
    logger.info(`Running scheduled task ${this.name}`);
    await this.handleScheduledTask(env);
  }

  protected abstract handleScheduledTask(env: Env): Promise<void>;
}

export { BaseScheduledTask };
export type { ScheduledTask, ScopeFactory };
