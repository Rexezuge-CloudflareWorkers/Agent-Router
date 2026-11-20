import { defineRepoVitestConfig } from '@rexezuge/tooling/vitest-repo';

/**
The unit suite, on the kit's single-file `projects` factory.

The workspace alias table, the `cloudflare:*` mocks and the `@rexezuge/*`
inlining all come from the factory; this file keeps only what is specific to
Agent-Router.
*/
export default defineRepoVitestConfig({
  scope: '@agent-router',
  root: new URL('.', import.meta.url).href,

  packages: ['shared', 'backend-runtime', 'backend-data', 'provider-clients', 'backend-services'],

  mocks: ['workers', 'sockets', 'workflows'],

  backend: {
    include: ['test/**/*.test.ts'],
    exclude: ['**/node_modules/**', 'test/integration/**'],
    // `@rexezuge/runtime` re-exports worker bases that import
    // `cloudflare:workers`; inline it so the mock alias applies instead of Node
    // rejecting the scheme.
    serverDepsInline: ['@rexezuge/runtime'],
  },

  coverageInclude: ['apps/api/src/**/*.ts', 'apps/background/src/**/*.ts', 'packages/**/src/**/*.ts'],

  coverageExclude: ['**/model/**'],

  // Raised after the hardening pass added DAO, auth, adapter, cron and
  // composition coverage. Actuals sit above these floors; keep headroom so a
  // refactor that trims a few branches does not fail the gate outright.
  thresholds: { statements: 50, branches: 40, functions: 50, lines: 50 },
});
