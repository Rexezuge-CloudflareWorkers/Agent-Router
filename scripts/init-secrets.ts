#!/usr/bin/env tsx

/**
 * Creates the Secrets Store entries declared in `wrangler.jsonc`, generating a
 * fresh value for each one that does not exist yet.
 *
 * Mirrors `../AWS-AccessBridge/scripts/deploy/init-secrets.ts`: every declared
 * secret must have a generator, listing failures are fatal (never guess that a
 * secret is absent), values are passed on stdin instead of argv, and a failure
 * exits non-zero so the deploy pipeline retries/fails instead of reporting a
 * green step that created nothing.
 *
 * Requires a materialized `wrangler.jsonc`; run `prepare-wrangler-config.ts`
 * first.
 */

import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parse, type ParseError } from 'jsonc-parser';

interface WranglerConfig {
  secrets_store_secrets?: Array<{
    binding: string;
    store_id: string;
    secret_name: string;
  }>;
}

const SECRET_NAMES = {
  providerKeys: 'agent-router-provider-keys-encryption-key',
  codexOAuth: 'agent-router-codex-oauth-encryption-key',
  commandCodeFingerprintSalt: 'agent-router-command-code-fingerprint-salt',
} as const;

/**
 * Generates a value for each secret this script knows how to create. Anything
 * else must be supplied out of band, so an unrecognised name fails instead of
 * silently provisioning an unusable value.
 */
const SECRET_GENERATORS: Readonly<Record<string, () => Promise<string>>> = {
  [SECRET_NAMES.providerKeys]: generateAESGCMKey,
  [SECRET_NAMES.codexOAuth]: generateAESGCMKey,
  [SECRET_NAMES.commandCodeFingerprintSalt]: generateFingerprintSalt,
};

/**
 * Runs a wrangler subcommand, optionally feeding `input` on stdin.
 *
 * Arguments are passed as an argv array rather than interpolated into a shell
 * string, so a value containing shell metacharacters cannot alter the command.
 */
function wrangler(args: string[], input?: string): string {
  try {
    return execFileSync('pnpm', ['exec', 'wrangler', ...args], {
      encoding: 'utf8',
      stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
      ...(input !== undefined && { input }),
    });
  } catch (error: unknown) {
    const processError = error as { stdout?: string | Buffer; stderr?: string | Buffer; message?: string };
    const stdout = processError.stdout ? processError.stdout.toString() : '';
    const stderr = processError.stderr ? processError.stderr.toString() : '';
    throw new Error(
      `Command failed: pnpm exec wrangler ${args.join(' ')}\n${stdout}${stderr || processError.message || ''}`,
    );
  }
}

function parseWranglerConfig(): WranglerConfig {
  const configPath = path.join(process.cwd(), 'wrangler.jsonc');
  let content: string;
  try {
    content = readFileSync(configPath, 'utf8');
  } catch {
    throw new Error(
      `${configPath} not found. Run scripts/prepare-wrangler-config.ts first — it is what creates the file this script reads.`,
    );
  }

  // `parse` is error-tolerant and returns a partial object, so an empty result
  // means malformed JSON rather than "no secrets declared". Treating that as
  // an empty list would report success having created nothing.
  const errors: ParseError[] = [];
  const config = parse(content, errors, { allowTrailingComma: true }) as WranglerConfig;
  if (errors.length > 0) {
    const first = errors[0];
    throw new Error(
      `${configPath} is not valid JSONC: ${errors.length} parse error(s), first at offset ${first?.offset}. Run prepare-wrangler-config.ts to regenerate it.`,
    );
  }
  return config;
}

/**
 * Lists the secret names present in a Secrets Store.
 *
 * Returns `undefined` when the listing itself failed, which is deliberately
 * distinct from an empty list: a transient CLI failure must not be read as
 * "the secret is missing" and cause a duplicate insert.
 */
function listSecretNames(storeId: string): Set<string> | undefined {
  let output: string;
  try {
    output = wrangler(['secrets-store', 'secret', 'list', storeId, '--remote']);
  } catch (error: unknown) {
    console.warn(`Unable to list secrets in store ${storeId}:`, error instanceof Error ? error.message : 'unknown error');
    return undefined;
  }

  // Take the first table column exactly: a substring match would let
  // `agent-router-codex-oauth-encryption-key-2` satisfy a search for
  // `agent-router-codex-oauth-encryption-key`.
  const names: Set<string> = new Set();
  for (const line of output.split('\n')) {
    const cells = line
      .split(/[│|]/)
      .map((cell) => cell.trim())
      .filter(Boolean);
    const name = cells[0];
    if (name && name !== 'Name' && !/^[─-]+$/.test(name)) {
      names.add(name);
    }
  }
  return names;
}

/**
 * A base64 AES-256-GCM key, matching what the worker's crypto layer expects.
 */
async function generateAESGCMKey(): Promise<string> {
  const key: CryptoKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  const exported: ArrayBuffer = await crypto.subtle.exportKey('raw', key);
  let binary = '';
  for (const byte of new Uint8Array(exported)) {
    binary += String.fromCodePoint(byte);
  }
  return btoa(binary);
}

/**
 * A 256-bit salt for the deterministic Command Code device fingerprint. The
 * value is not itself a key, but it must stay secret: a leaked salt lets
 * anyone recompute a deployment's device identities from provider keys.
 */
function generateFingerprintSalt(): Promise<string> {
  return Promise.resolve(randomBytes(32).toString('base64'));
}

function createSecret(storeId: string, secretName: string, secretValue: string): void {
  console.log(`Creating secret: ${secretName}`);
  // The value is passed on stdin, not as a shell argument. Interpolating it
  // into a command string would expose the secret value in the process table
  // and in any process-argv logging on the runner.
  wrangler(['secrets-store', 'secret', 'create', storeId, '--name', secretName, '--scopes', 'workers', '--remote'], secretValue);
  console.log(`Created secret: ${secretName}`);
}

async function main(): Promise<void> {
  console.log('Initializing Cloudflare secrets...');
  const config: WranglerConfig = parseWranglerConfig();
  const listedByStore: Map<string, Set<string> | undefined> = new Map();

  const declaredSecrets = config.secrets_store_secrets ?? [];
  if (declaredSecrets.length === 0) {
    throw new Error('wrangler.jsonc declares no secrets_store_secrets entries, so there is nothing to initialize.');
  }

  for (const secret of declaredSecrets) {
    if (!listedByStore.has(secret.store_id)) {
      listedByStore.set(secret.store_id, listSecretNames(secret.store_id));
    }
    const existing = listedByStore.get(secret.store_id);
    if (existing === undefined) {
      // Refuse to guess: creating a secret we could not read back risks
      // overwriting a live value with a freshly generated one.
      throw new Error(
        `Could not list secrets in store ${secret.store_id}; refusing to create ${secret.secret_name} without confirming it is absent.`,
      );
    }
    if (existing.has(secret.secret_name)) {
      console.log(`Secret ${secret.secret_name} already exists`);
      continue;
    }

    const generate = SECRET_GENERATORS[secret.secret_name];
    if (!generate) {
      throw new Error(`Unknown secret: ${secret.secret_name}`);
    }
    const secretValue = await generate();
    console.log(`Generated value for ${secret.secret_name}`);
    createSecret(secret.store_id, secret.secret_name, secretValue);
    existing.add(secret.secret_name);
  }
  console.log('Secret initialization complete');
}

// A rejected `main` must exit non-zero: this runs in the deploy pipeline, and
// swallowing the rejection would report a failed key bootstrap as a green step
// that `retry-step` would not retry.
main().catch((error: unknown) => {
  console.error('Secret initialization failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
