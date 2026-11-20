import type { ProviderKind } from '@agent-router/shared';

interface UpstreamCall {
  url: string;
  headers: Record<string, string>;
  body: string;
}

interface ParsedUsage {
  promptTokens: number;
  completionTokens: number;
  estimated: boolean;
}

interface BuildCallInput {
  baseUrl: string | null;
  path: string;
  secret: string;
  body: unknown;
  anthropicVersion?: string;
  rawBody?: string;
}

/**
One upstream provider's request shape and usage extraction.

`buildUpstreamCall` and `parseUsage` used to be `if (kind === …)` branches in a
single file, which meant adding a provider touched several unrelated spots and
made the branches hard to test in isolation. Each kind owns a small adapter
implementing this contract; `getAdapter` is the only lookup.
*/
interface ProviderAdapter {
  readonly kind: ProviderKind;
  buildCall(input: BuildCallInput): UpstreamCall;
  parseUsage(json: unknown): ParsedUsage;
}

const NO_USAGE: ParsedUsage = { promptTokens: 0, completionTokens: 0, estimated: true };

/** Shared URL join: strips a trailing slash from the base, adds exactly one
separator before the path. */
function joinUrl(base: string, path: string): string {
  const normalizedBase = base.replace(/\/$/, '');
  return `${normalizedBase}${path.startsWith('/') ? path : `/${path}`}`;
}

export { NO_USAGE, joinUrl };
export type { BuildCallInput, ParsedUsage, ProviderAdapter, UpstreamCall };
