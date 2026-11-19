import { EnvParser } from '@rexezuge/runtime';
import {
  DEFAULT_MAX_PACK_OBJECTS,
  DEFAULT_GIT_CACHE_TTL_SECONDS,
  DEFAULT_MAX_FETCH_WANTS,
  DEFAULT_MAX_FETCH_HAVES,
  DEFAULT_MAX_PUSH_COMMANDS,
  DEFAULT_MAX_PACK_BYTES,
  DEFAULT_MAX_FETCH_BODY_BYTES,
  DEFAULT_MAX_MERGE_DIFF_FILES,
  DEFAULT_MAX_FILE_BYTES,
} from '../ConfigurationDefaults';

// Git protocol / pack limits.
class GitLimits {
  constructor(private readonly env: unknown) {}

  public getMaxPackObjects(): number {
    return EnvParser.positiveInt(this.env, 'MAX_PACK_OBJECTS', DEFAULT_MAX_PACK_OBJECTS);
  }

  public getGitCacheTtlSeconds(): number {
    return EnvParser.positiveInt(this.env, 'GIT_CACHE_TTL_SECONDS', DEFAULT_GIT_CACHE_TTL_SECONDS);
  }

  public getMaxFetchWants(): number {
    return EnvParser.positiveInt(this.env, 'MAX_FETCH_WANTS', DEFAULT_MAX_FETCH_WANTS);
  }

  public getMaxFetchHaves(): number {
    return EnvParser.positiveInt(this.env, 'MAX_FETCH_HAVES', DEFAULT_MAX_FETCH_HAVES);
  }

  public getMaxPushCommands(): number {
    return EnvParser.positiveInt(this.env, 'MAX_PUSH_COMMANDS', DEFAULT_MAX_PUSH_COMMANDS);
  }

  public getMaxPackBytes(): number {
    return EnvParser.positiveInt(this.env, 'MAX_PACK_BYTES', DEFAULT_MAX_PACK_BYTES);
  }

  public getMaxFetchBodyBytes(): number {
    return EnvParser.positiveInt(this.env, 'MAX_FETCH_BODY_BYTES', DEFAULT_MAX_FETCH_BODY_BYTES);
  }

  public getMaxMergeDiffFiles(): number {
    return EnvParser.positiveInt(this.env, 'MAX_MERGE_DIFF_FILES', DEFAULT_MAX_MERGE_DIFF_FILES);
  }

  public getMaxFileBytes(): number {
    return EnvParser.positiveInt(this.env, 'MAX_FILE_BYTES', DEFAULT_MAX_FILE_BYTES);
  }
}

export { GitLimits };
