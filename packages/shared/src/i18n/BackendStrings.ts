import { canonicalizeLanguageTag } from '../utils/LanguageTag';

const SUPPORTED_BACKEND_LOCALES = ['en', 'zh-CN'] as const;

type SupportedBackendLocale = (typeof SUPPORTED_BACKEND_LOCALES)[number];

interface CommonStrings {
  unauthorized: string;
  forbidden: string;
  internalError: string;
}

interface RepoStrings {
  notFound: string;
  visibilityDenied: string;
  created: string;
  deleted: string;
}

interface TokenStrings {
  created: string;
  revoked: string;
  limitReached: string;
}

interface IssueStrings {
  created: string;
}

interface GitStrings {
  pushRejected: string;
}

interface NamespaceStrings {
  reserved: string;
}

interface BackendLocaleStrings {
  common: CommonStrings;
  repo: RepoStrings;
  token: TokenStrings;
  issue: IssueStrings;
  git: GitStrings;
  namespace: NamespaceStrings;
}

function formatBackendString(template: string, vars: Record<string, string | number> = {}): string {
  return template.replaceAll(/\{(\w+)\}/g, (match: string, key: string): string => {
    const value: unknown = vars[key];
    return typeof value === 'string' || typeof value === 'number' ? String(value) : match;
  });
}

function canonicalizeBackendLocaleTag(tag: string): string {
  return canonicalizeLanguageTag(tag);
}

function normalizeBackendLocale(locale: string | null | undefined): SupportedBackendLocale {
  if (!locale || typeof locale !== 'string') return 'en';
  const canonical = canonicalizeBackendLocaleTag(locale);
  if ((SUPPORTED_BACKEND_LOCALES as readonly string[]).includes(canonical)) {
    return canonical as SupportedBackendLocale;
  }
  const base = canonical.split('-', 1)[0]?.toLowerCase() ?? 'en';
  return base === 'zh' ? 'zh-CN' : 'en';
}

export type {
  BackendLocaleStrings,
  CommonStrings,
  RepoStrings,
  TokenStrings,
  IssueStrings,
  GitStrings,
  NamespaceStrings,
  SupportedBackendLocale,
};
export { SUPPORTED_BACKEND_LOCALES, canonicalizeBackendLocaleTag, formatBackendString, normalizeBackendLocale };
