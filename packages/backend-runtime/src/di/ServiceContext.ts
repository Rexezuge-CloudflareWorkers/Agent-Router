import type { ServiceEnv } from '../config/ServiceEnv';

/**
Minimal logger / clock contracts for Agent-Router services.
Kept in backend-runtime (Layer 1) so shared (Layer 0) stays dependency-free.
*/
interface ILogger {
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

interface IClock {
  nowSeconds(): number;
}

class ConsoleLogger implements ILogger {
  public debug(...args: unknown[]): void {
    console.debug(...args);
  }

  public info(...args: unknown[]): void {
    console.info(...args);
  }

  public warn(...args: unknown[]): void {
    console.warn(...args);
  }

  public error(...args: unknown[]): void {
    console.error(...args);
  }
}

class SystemClock implements IClock {
  public nowSeconds(): number {
    return Math.floor(Date.now() / 1000);
  }
}

/**
Single request-scoped context for Agent-Router domain services.
*/
interface ServiceContext {
  readonly env: ServiceEnv;
  readonly logger: ILogger;
  readonly clock: IClock;
}

interface ServiceContextOverrides {
  logger?: ILogger;
  clock?: IClock;
}

function createServiceContext(env: ServiceEnv, overrides: ServiceContextOverrides = {}): ServiceContext {
  return {
    env,
    logger: overrides.logger ?? new ConsoleLogger(),
    clock: overrides.clock ?? new SystemClock(),
  };
}

export { ConsoleLogger, SystemClock, createServiceContext };
export type { IClock, ILogger, ServiceContext, ServiceContextOverrides };
