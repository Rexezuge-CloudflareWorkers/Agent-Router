import { z } from 'zod';
import { OWNER_PATTERN, REPO_PATTERN } from '../utils/Identity';

const usernameSchema = z.string().trim().min(1).max(39).regex(OWNER_PATTERN, 'Invalid username');

const teamSlugSchema = z.string().trim().min(1).max(39).regex(OWNER_PATTERN, 'Invalid team slug');

const repoNameSchema = z.string().trim().min(1).max(100).regex(REPO_PATTERN, 'Invalid repository name');

// Control characters are rejected via code points (not a regex) so the
// `no-control-regex` lint rule stays satisfied.
function hasNoControlChars(name: string): boolean {
  for (const ch of name) {
    const code = ch.codePointAt(0) ?? 0;
    if (code === 0x7f || code <= 0x1f) return false;
  }
  return true;
}

const branchNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .refine((name) => !name.includes('..'), 'Invalid branch name')
  .refine((name) => !name.includes('//'), 'Invalid branch name')
  .refine((name) => !name.includes('\0'), 'Invalid branch name')
  .refine(
    (name) => !name.endsWith('.') && !name.endsWith('/') && !name.endsWith('.lock'),
    'Invalid branch name',
  )
  .refine((name) => !/[\s~^:?*[\]@{\\]/.test(name) && hasNoControlChars(name), 'Invalid branch name')
  .refine(
    (name) => name.split('/').every((seg) => seg.length > 0 && seg !== '.' && seg !== '..' && seg !== '@'),
    'Invalid branch name',
  );

const assetNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .refine(
    (name) =>
      !name.includes('..') &&
      !name.includes('/') &&
      !name.includes('\\') &&
      !name.includes('\0') &&
      name !== '.git' &&
      !name.startsWith('.git/'),
    'Invalid asset name',
  );

const MAX_RESOURCE_NUMBER = 2_147_483_647;

function parsePositiveInt(raw: string | undefined | null, max: number = MAX_RESOURCE_NUMBER): number | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed || !/^\d+$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return !Number.isSafeInteger(parsed) || parsed < 1 || parsed > max ? null : parsed;
}

const tokenIdSchema = z.string().trim().uuid('Invalid token id');

const MAX_AUDIT_FILTER_LENGTH = 200;
const MAX_AUDIT_LIMIT = 100;

function clampAuditLimit(raw: number | undefined): number | undefined {
  if (raw === undefined) return undefined;
  if (!Number.isSafeInteger(raw)) return undefined;
  return raw < 1 ? undefined : Math.min(raw, MAX_AUDIT_LIMIT);
}

function truncateAuditFilter(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, MAX_AUDIT_FILTER_LENGTH) : undefined;
}

function sanitizeCommitMessage(raw: unknown, fallback: string): string {
  const text = typeof raw === 'string' && raw.trim() ? raw.trim() : fallback;
  const stripped = [...text].filter((ch) => {
    const code = ch.codePointAt(0) ?? 0;
    return code > 0x1f && code !== 0x7f;
  }).join('');
  const collapsed = stripped.replaceAll(/[ \t]+/g, ' ').trim();
  const safe = collapsed || fallback;
  return safe.slice(0, 1000);
}

function decodeBase64Strict(input: string): Uint8Array | null {
  try {
    const clean = input.replaceAll(/\s/g, '');
    if (!clean || clean.length % 4 === 1 || !/^[a-z0-9+/]*={0,2}$/i.test(clean)) return null;
    const binary = atob(clean);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.codePointAt(i) ?? 0;
    return bytes;
  } catch {
    return null;
  }
}

const ALLOWED_ASSET_CONTENT_TYPES = new Set([
  'application/octet-stream',
  'application/zip',
  'application/gzip',
  'application/x-tar',
  'application/json',
  'text/plain',
]);

function normalizeAssetContentType(raw: unknown): string {
  if (typeof raw !== 'string') return 'application/octet-stream';
  const trimmed = raw.trim().split(';', 1)[0].trim().toLowerCase();
  if (!trimmed || trimmed.length > 128 || !/^[\w.+-]+\/[\w.+-]+$/.test(trimmed) || trimmed.startsWith('text/html') || trimmed.startsWith('image/svg')) return 'application/octet-stream';
  return ALLOWED_ASSET_CONTENT_TYPES.has(trimmed) ? trimmed : 'application/octet-stream';
}

export {
  usernameSchema,
  teamSlugSchema,
  repoNameSchema,
  branchNameSchema,
  assetNameSchema,
  parsePositiveInt,
  tokenIdSchema,
  clampAuditLimit,
  truncateAuditFilter,
  sanitizeCommitMessage,
  decodeBase64Strict,
  normalizeAssetContentType,
  MAX_RESOURCE_NUMBER,
  MAX_AUDIT_FILTER_LENGTH,
  MAX_AUDIT_LIMIT,
};
