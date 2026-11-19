import { EnvParser } from '@rexezuge/runtime';
import {
  DEFAULT_REALTIME_ENABLED,
  DEFAULT_REALTIME_MAX_CONN_PER_INBOX_SHARD,
  DEFAULT_REALTIME_MAX_CONN_PER_REPO_SHARD,
  DEFAULT_REALTIME_TICKET_TTL_SECONDS,
} from '../ConfigurationDefaults';

// Realtime shard limits.
class RealtimeLimits {
  constructor(private readonly env: unknown) {}

  public isEnabled(): boolean {
    return EnvParser.boolean(this.env, 'REALTIME_ENABLED', DEFAULT_REALTIME_ENABLED);
  }

  public getTicketTtlSeconds(): number {
    return EnvParser.positiveInt(this.env, 'REALTIME_TICKET_TTL_SECONDS', DEFAULT_REALTIME_TICKET_TTL_SECONDS);
  }

  public getMaxConnPerRepoShard(): number {
    return EnvParser.positiveInt(this.env, 'REALTIME_MAX_CONN_PER_REPO_SHARD', DEFAULT_REALTIME_MAX_CONN_PER_REPO_SHARD);
  }

  public getMaxConnPerInboxShard(): number {
    return EnvParser.positiveInt(this.env, 'REALTIME_MAX_CONN_PER_INBOX_SHARD', DEFAULT_REALTIME_MAX_CONN_PER_INBOX_SHARD);
  }
}

export { RealtimeLimits };
