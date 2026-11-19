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

  // Scaffold baseline: router core covered; raise stepwise toward 70/55/70/70
  // as proxy/cron/UI tests land.
  thresholds: { statements: 20, branches: 15, functions: 12, lines: 22 },
});
