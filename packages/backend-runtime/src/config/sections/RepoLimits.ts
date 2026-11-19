import { EnvParser } from '@rexezuge/runtime';
import {
  DEFAULT_MAX_REPOS_PER_USER,
  DEFAULT_MAX_RULES_PER_REPO,
  DEFAULT_MAX_TOKENS_PER_USER,
  DEFAULT_MAX_TOKEN_EXPIRY_DAYS,
  DEFAULT_MAX_TOKEN_REPO_GRANTS,
  DEFAULT_MAX_TEAMS_PER_ORG,
  DEFAULT_MAX_TEAM_GRANTS,
  DEFAULT_MAX_TEAM_MEMBERS,
  DEFAULT_MAX_SNIPPETS_PER_USER,
  DEFAULT_MAX_FILES_PER_SNIPPET,
  DEFAULT_MAX_SNIPPET_BYTES,
} from '../ConfigurationDefaults';

// Repository / identity limits.
class RepoLimits {
  constructor(private readonly env: unknown) {}

  public getMaxReposPerUser(): number {
    return EnvParser.positiveInt(this.env, 'MAX_REPOS_PER_USER', DEFAULT_MAX_REPOS_PER_USER);
  }

  public getMaxTokensPerUser(): number {
    return EnvParser.positiveInt(this.env, 'MAX_TOKENS_PER_USER', DEFAULT_MAX_TOKENS_PER_USER);
  }

  public getMaxTokenExpiryDays(): number {
    return EnvParser.positiveInt(this.env, 'MAX_TOKEN_EXPIRY_DAYS', DEFAULT_MAX_TOKEN_EXPIRY_DAYS);
  }

  public getMaxTokenRepoGrants(): number {
    return EnvParser.positiveInt(this.env, 'MAX_TOKEN_REPO_GRANTS', DEFAULT_MAX_TOKEN_REPO_GRANTS);
  }

  public getMaxRulesPerRepo(): number {
    return EnvParser.positiveInt(this.env, 'MAX_RULES_PER_REPO', DEFAULT_MAX_RULES_PER_REPO);
  }

  public getMaxTeamsPerOrg(): number {
    return EnvParser.positiveInt(this.env, 'MAX_TEAMS_PER_ORG', DEFAULT_MAX_TEAMS_PER_ORG);
  }

  public getMaxTeamMembers(): number {
    return EnvParser.positiveInt(this.env, 'MAX_TEAM_MEMBERS', DEFAULT_MAX_TEAM_MEMBERS);
  }

  public getMaxTeamGrants(): number {
    return EnvParser.positiveInt(this.env, 'MAX_TEAM_GRANTS', DEFAULT_MAX_TEAM_GRANTS);
  }

  public getMaxSnippetsPerUser(): number {
    return EnvParser.positiveInt(this.env, 'MAX_SNIPPETS_PER_USER', DEFAULT_MAX_SNIPPETS_PER_USER);
  }

  public getMaxFilesPerSnippet(): number {
    return EnvParser.positiveInt(this.env, 'MAX_FILES_PER_SNIPPET', DEFAULT_MAX_FILES_PER_SNIPPET);
  }

  public getMaxSnippetBytes(): number {
    return EnvParser.positiveInt(this.env, 'MAX_SNIPPET_BYTES', DEFAULT_MAX_SNIPPET_BYTES);
  }
}

export { RepoLimits };
