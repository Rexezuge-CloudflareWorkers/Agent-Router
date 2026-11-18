/**
System names reserved from the shared user ↔ org namespace.

A single-segment name in this set must never be claimed as a username or
organization name: it would shadow worker API roots (`/health`, `/docs`,
`/repos`, `/users`, `/user`, `/api`), SPA roots (`/`, `/new`, `/settings`,
`/search`, `/notifications`, `/:username`), or obvious future auth/product
roots (`login`, `admin`, `orgs`, ...). Comparison is case-insensitive.

Grandfathering: reads keep serving pre-existing rows; only creates,
renames, auto-bootstrap, and repo-owner validation reject these names.
*/
const RESERVED_NAMESPACE_NAMES_LIST: readonly string[] = [
  // Worker / API roots (AgentRouterWorker + public read-model).
  'health',
  'docs',
  'repos',
  'users',
  'user',
  'api',
  // SPA single-segment roots (SpaViewRouter + worker catch-all).
  'settings',
  'new',
  'search',
  'notifications',
  // Auth / infra future-proofing.
  'login',
  'logout',
  'signin',
  'signup',
  'sso',
  'oauth',
  'admin',
  'root',
  'system',
  'support',
  'help',
  'about',
  'status',
  'security',
  'contact',
  // Product future-proofing (GitHub-style).
  'orgs',
  'organizations',
  'explore',
  'trending',
  'stars',
  'topics',
  'collections',
  'features',
  'pricing',
  'marketplace',
  'gist',
  'gists',
  'git',
  'ssh',
  'assets',
  'static',
  'public',
  'realtime',
  'dashboard',
  'home',
  'profile',
  'profiles',
  'account',
  'accounts',
  'billing',
  'invitations',
  'enterprise',
] as const;

const RESERVED_NAMESPACE_NAMES: ReadonlySet<string> = new Set(RESERVED_NAMESPACE_NAMES_LIST);

function isReservedNamespaceName(name: string): boolean {
  return RESERVED_NAMESPACE_NAMES.has(name.trim().toLowerCase());
}

export { RESERVED_NAMESPACE_NAMES, RESERVED_NAMESPACE_NAMES_LIST, isReservedNamespaceName };
