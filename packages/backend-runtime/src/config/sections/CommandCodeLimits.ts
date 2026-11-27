import { EnvParser } from '@rexezuge/runtime';
import {
  DEFAULT_COMMAND_CODE_CLI_MODE,
  DEFAULT_COMMAND_CODE_CLI_SESSION_MODE,
  DEFAULT_COMMAND_CODE_DEVICE_PROJECT_DIR,
  DEFAULT_COMMAND_CODE_EMPTY_SYSTEM_PLACEHOLDER,
  DEFAULT_COMMAND_CODE_MAX_BODY_BYTES,
  DEFAULT_COMMAND_CODE_MAX_TOOL_IMAGE_MB,
  DEFAULT_COMMAND_CODE_MODELS_TTL_MS,
  DEFAULT_COMMAND_CODE_PROTOCOL_VERSION,
  DEFAULT_COMMAND_CODE_STREAM_HEARTBEAT_MS,
  DEFAULT_COMMAND_CODE_STREAM_IDLE_MS,
  DEFAULT_COMMAND_CODE_TIMEOUT_MS,
  DEFAULT_COMMAND_CODE_ZDR,
} from '../ConfigurationDefaults';

// Command Code upstream protocol settings. The fingerprint salt itself is a
// Secrets Store binding, not a plain var (see CommandCodeService), because a
// leaked salt lets anyone recompute a deployment's device identities.
class CommandCodeLimits {
  constructor(private readonly env: unknown) {}

  public getProtocolVersion(): string {
    return EnvParser.string(this.env, 'COMMAND_CODE_PROTOCOL_VERSION', DEFAULT_COMMAND_CODE_PROTOCOL_VERSION);
  }

  public getDeviceProjectDir(): string {
    return EnvParser.string(this.env, 'COMMAND_CODE_DEVICE_PROJECT_DIR', DEFAULT_COMMAND_CODE_DEVICE_PROJECT_DIR);
  }

  public getCliMode(): string {
    return EnvParser.string(this.env, 'COMMAND_CODE_CLI_MODE', DEFAULT_COMMAND_CODE_CLI_MODE);
  }

  public getCliSessionMode(): string {
    return EnvParser.string(this.env, 'COMMAND_CODE_CLI_SESSION_MODE', DEFAULT_COMMAND_CODE_CLI_SESSION_MODE);
  }

  public isEmptySystemPlaceholderEnabled(): boolean {
    return EnvParser.boolean(this.env, 'COMMAND_CODE_EMPTY_SYSTEM_PLACEHOLDER', DEFAULT_COMMAND_CODE_EMPTY_SYSTEM_PLACEHOLDER);
  }

  public isZdrEnabled(): boolean {
    return EnvParser.boolean(this.env, 'COMMAND_CODE_ZDR', DEFAULT_COMMAND_CODE_ZDR);
  }

  public getMaxBodyBytes(): number {
    return EnvParser.positiveInt(this.env, 'COMMAND_CODE_MAX_BODY_BYTES', DEFAULT_COMMAND_CODE_MAX_BODY_BYTES);
  }

  public getTimeoutMs(): number {
    return EnvParser.positiveInt(this.env, 'COMMAND_CODE_TIMEOUT_MS', DEFAULT_COMMAND_CODE_TIMEOUT_MS);
  }

  public getStreamIdleMs(): number {
    return EnvParser.positiveInt(this.env, 'COMMAND_CODE_STREAM_IDLE_MS', DEFAULT_COMMAND_CODE_STREAM_IDLE_MS);
  }

  public getStreamHeartbeatMs(): number {
    return EnvParser.positiveInt(this.env, 'COMMAND_CODE_STREAM_HEARTBEAT_MS', DEFAULT_COMMAND_CODE_STREAM_HEARTBEAT_MS);
  }

  public getMaxToolImageMb(): number {
    return EnvParser.positiveInt(this.env, 'COMMAND_CODE_MAX_TOOL_IMAGE_MB', DEFAULT_COMMAND_CODE_MAX_TOOL_IMAGE_MB);
  }

  public getModelsTtlMs(): number {
    return EnvParser.positiveInt(this.env, 'COMMAND_CODE_MODELS_TTL_MS', DEFAULT_COMMAND_CODE_MODELS_TTL_MS);
  }
}

export { CommandCodeLimits };
