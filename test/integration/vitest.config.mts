import { defineIntegrationVitestConfig } from '@rexezuge/tooling/vitest-integration';
import { cloudflareTest, cloudflarePool } from '@cloudflare/vitest-pool-workers';
import { fileURLToPath } from 'node:url';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const migrationsDir = path.resolve(fileURLToPath(new URL('../../migrations', import.meta.url)));
const migrationFiles = readdirSync(migrationsDir)
  .filter((f) => f.endsWith('.sql'))
  .toSorted((left, right) => left.localeCompare(right));
const migrationSql = migrationFiles.map((f) => readFileSync(path.resolve(migrationsDir, f), 'utf8')).join('\n\n');

/**
The workerd integration suite, on the kit's factory.

The factory generates the `@agent-router/* → src` table from `scope`, so this
table cannot drift from the unit suite's. The plugins, pool and define blocks
below are harness wiring the factory passes through untouched.
*/
export default defineIntegrationVitestConfig({
  scope: '@agent-router',
  root: new URL('../../', import.meta.url).href,
  packages: ['shared', 'backend-runtime', 'backend-data', 'provider-clients', 'backend-services'],
  include: ['test/integration/**/*.int.test.ts'],
  plugins: [
    cloudflareTest({
      wrangler: {
        configPath: './test/integration/wrangler.test.jsonc',
      },
    }),
  ],
  pool: cloudflarePool({
    wrangler: {
      configPath: './test/integration/wrangler.test.jsonc',
    },
  }),
  define: {
    __INTEGRATION_MIGRATION_SQL__: JSON.stringify(migrationSql),
  },
  ssrNoExternal: ['hono', 'chanfana', '@agent-router'],
});
