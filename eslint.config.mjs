import reactHooks from 'eslint-plugin-react-hooks';
import { defineRepoLintConfig } from '@rexezuge/tooling/eslint';

/**
 * The family's converged lint configuration.
 *
 * All layer rules live in the kit's factory; this file names only what is
 * genuinely this repository's: which packages exist, and the boundary `apps/api`
 * needs beyond the canonical table.
 */
export default [
  ...defineRepoLintConfig({
    scope: '@agent-router',

    projectDirs: [
      'packages/shared',
      'packages/backend-runtime',
      'packages/backend-data',
      'packages/provider-clients',
      'packages/backend-services',
    ],

    tsconfigRootDir: import.meta.dirname,

    // Scripts are TypeScript so the repo's own gates are linted and typechecked
    // rather than trusted.
    extraIgnores: ['!scripts/**'],

    /**
     * `apps/api` reaches DAOs and raw upstream clients only through
     * `backend-services`, resolved off the request scope. Type-only imports are
     * permitted for route shapes.
     */
    extraLayers: [
      {
        dir: 'apps/api',
        ban: ['@agent-router/provider-clients', '@agent-router/backend-data/dao'],
        allowTypeImports: true,
        message:
          'apps/api must not import provider-clients or a DAO directly — add a method to the owning backend-services domain service and resolve it through the request scope. Type-only imports are allowed.',
      },
    ],
  }),

  {
    files: ['apps/web/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs['recommended-latest'].rules,
  },
];
