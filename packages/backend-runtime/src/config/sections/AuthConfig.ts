import { EnvParser } from '@rexezuge/runtime';
import { DEFAULT_ENVIRONMENT } from '../ConfigurationDefaults';

// Auth / environment identity. Centralizes TEAM_DOMAIN/POLICY_AUD/DEV+DEMO vars.
class AuthConfig {
  constructor(private readonly env: unknown) {}

  public getEnvironment(): string {
    const raw = EnvParser.string(this.env, 'ENVIRONMENT', DEFAULT_ENVIRONMENT);
    const normalized = raw.trim().toLowerCase();
    return normalized === '' ? DEFAULT_ENVIRONMENT : normalized;
  }

  public isBypassAllowed(): boolean {
    // Local/dev bypasses (DEMO_MODE/DEV_AUTH_EMAIL) are only honored when
    // ENVIRONMENT is explicitly non-production. The default is production
    // (secure by default): deploys that forget ENVIRONMENT deny bypass
    // instead of opening auth. Local `wrangler dev` and integration tests
    // must set ENVIRONMENT=development explicitly.
    return this.getEnvironment() !== 'production';
  }

  public isDemoMode(): boolean {
    return EnvParser.boolean(this.env, 'DEMO_MODE', 'false');
  }

  public getDevAuthEmail(): string | null {
    const value = EnvParser.string(this.env, 'DEV_AUTH_EMAIL', '');
    return value === '' ? null : value;
  }

  public getDemoUserEmail(): string | null {
    const value = EnvParser.string(this.env, 'DEMO_USER_EMAIL', '');
    return value === '' ? null : value;
  }

  public getTeamDomain(): string | null {
    const value = EnvParser.string(this.env, 'TEAM_DOMAIN', '');
    return value === '' ? null : value;
  }

  public getPolicyAud(): string | null {
    const value = EnvParser.string(this.env, 'POLICY_AUD', '');
    return value === '' ? null : value;
  }
}

export { AuthConfig };
