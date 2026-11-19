import { EnvParser } from '@rexezuge/runtime';
import {
  DEFAULT_MAX_HOOKS_PER_REPO,
  DEFAULT_WEBHOOK_DELIVERY_RETENTION_DAYS,
  DEFAULT_WEBHOOK_MAX_ATTEMPTS,
  DEFAULT_WEBHOOK_TIMEOUT_MS,
  DEFAULT_WEBHOOK_MAX_CONSECUTIVE_FAILURES,
  DEFAULT_WEBHOOK_MAX_PAYLOAD_BYTES,
} from '../ConfigurationDefaults';

// Webhook fan-out limits.
class WebhookLimits {
  constructor(private readonly env: unknown) {}

  public getMaxHooksPerRepo(): number {
    return EnvParser.positiveInt(this.env, 'MAX_HOOKS_PER_REPO', DEFAULT_MAX_HOOKS_PER_REPO);
  }

  public getDeliveryRetentionDays(): number {
    return EnvParser.positiveInt(this.env, 'WEBHOOK_DELIVERY_RETENTION_DAYS', DEFAULT_WEBHOOK_DELIVERY_RETENTION_DAYS);
  }

  public getMaxAttempts(): number {
    return EnvParser.positiveInt(this.env, 'WEBHOOK_MAX_ATTEMPTS', DEFAULT_WEBHOOK_MAX_ATTEMPTS);
  }

  public getTimeoutMs(): number {
    return EnvParser.positiveInt(this.env, 'WEBHOOK_TIMEOUT_MS', DEFAULT_WEBHOOK_TIMEOUT_MS);
  }

  public getMaxConsecutiveFailures(): number {
    return EnvParser.positiveInt(this.env, 'WEBHOOK_MAX_CONSECUTIVE_FAILURES', DEFAULT_WEBHOOK_MAX_CONSECUTIVE_FAILURES);
  }

  public getMaxPayloadBytes(): number {
    return EnvParser.positiveInt(this.env, 'WEBHOOK_MAX_PAYLOAD_BYTES', DEFAULT_WEBHOOK_MAX_PAYLOAD_BYTES);
  }
}

export { WebhookLimits };
