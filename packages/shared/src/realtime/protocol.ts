// Realtime collaboration protocol (layer 0 — no @agent-router/* imports).
//
// One Durable Object shard per repo (`repo:<owner>/<name>`) plus a single
// global inbox shard (`inbox:global`) expose hibernatable WebSockets. The API
// Worker mints short-lived single-use tickets (stored in DO storage, never
// D1 — the free-plan D1 write budget is reserved for source-of-truth rows);
// clients upgrade at `GET /realtime/ws?shard=…&ticket=…` and subscribe to the
// channels encoded in the ticket. Mutations publish one RPC per shard;
// broadcast to N sockets inside the DO costs a single DO request.

const REALTIME_VERSION = 1;

const INBOX_SHARD = 'inbox:global';

const MAX_CHANNEL_LENGTH = 96;
const MAX_EVENT_TYPE_LENGTH = 64;
const MAX_TITLE_LENGTH = 200;
const MAX_MESSAGE_BYTES = 4096;

// Free-plan guardrails. Tunables live in ConfigurationDefaults; these are the
// protocol-level fallbacks used when env parsing is unavailable (DO unit
// tests, client mirror).
const MAX_CHANNELS_PER_SOCKET = 20;
const MAX_CLIENT_FRAMES_PER_MINUTE = 30;
const PRESENCE_TTL_SECONDS = 75;

const SHARD_RE = /^(?:repo:[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?\/[a-z0-9._-]{1,100}|inbox:global)$/;
// `inbox:<hash>` channels only exist on the global inbox shard; the ticket
// route only ever grants a viewer their own hash.
const CHANNEL_RE = /^(?:activity|presence|issue:\d{1,10}|pr:\d{1,10}|checks:[0-9a-f]{4,64}|inbox:[0-9a-f]{16,64})$/;
const EVENT_TYPE_RE = /^[a-z][a-z0-9._-]{0,63}$/;
const INBOX_HASH_RE = /^[0-9a-f]{16,64}$/;
const TICKET_ID_RE = /^[\w-]{16,128}$/;

function repoShardFor(fullName: string): string {
  return `repo:${fullName.toLowerCase()}`;
}

function isRepoShard(shard: unknown): boolean {
  return typeof shard === 'string' && shard.startsWith('repo:') && SHARD_RE.test(shard);
}

function isShard(shard: unknown): boolean {
  return typeof shard === 'string' && SHARD_RE.test(shard);
}

function isChannel(channel: unknown): channel is string {
  return typeof channel === 'string' && channel.length <= MAX_CHANNEL_LENGTH && CHANNEL_RE.test(channel);
}

function isInboxHash(value: unknown): value is string {
  return typeof value === 'string' && INBOX_HASH_RE.test(value);
}

function inboxTagForHash(hash: string): string {
  return `inbox:${hash}`;
}

function normalizeChannels(channels: unknown, limit: number = MAX_CHANNELS_PER_SOCKET): string[] {
  if (!Array.isArray(channels)) return [];
  const seen = new Set<string>();
  for (const channel of channels) {
    if (isChannel(channel)) seen.add(channel);
    if (seen.size >= limit) break;
  }
  return [...seen];
}

interface RealtimeEnvelope {
  v: 1;
  id: string;
  ts: number;
  channel: string;
  type: string;
  actor: string;
  title: string;
  subjectType: string | null;
  subjectNumber: number | null;
  sha: string | null;
  extra: Record<string, unknown>;
}

function isEnvelope(value: unknown): value is RealtimeEnvelope {
  if (typeof value !== 'object' || value === null) return false;
  const event = value as Record<string, unknown>;
  return (
    event.v === REALTIME_VERSION &&
    typeof event.id === 'string' &&
    event.id.length > 0 &&
    event.id.length <= 128 &&
    typeof event.ts === 'number' &&
    Number.isSafeInteger(event.ts) &&
    isChannel(event.channel) &&
    typeof event.type === 'string' &&
    EVENT_TYPE_RE.test(event.type) &&
    typeof event.actor === 'string' &&
    event.actor.length <= 320 &&
    typeof event.title === 'string' &&
    event.title.length <= MAX_TITLE_LENGTH
  );
}

interface BuildEnvelopeInput {
  id: string;
  ts: number;
  channel: string;
  type: string;
  actor: string;
  title: string;
  subjectType?: string | null;
  subjectNumber?: number | null;
  sha?: string | null;
  extra?: Record<string, unknown>;
}

function buildEnvelope(input: BuildEnvelopeInput): RealtimeEnvelope | null {
  if (!isChannel(input.channel) || !EVENT_TYPE_RE.test(input.type) || typeof input.actor !== 'string' || input.actor.length > 320) return null;
  const title = input.title.slice(0, MAX_TITLE_LENGTH);
  const extra: Record<string, unknown> = input.extra && typeof input.extra === 'object' ? input.extra : {};
  return {
    v: REALTIME_VERSION,
    id: input.id.slice(0, 128),
    ts: input.ts,
    channel: input.channel,
    type: input.type,
    actor: input.actor,
    title,
    subjectType: input.subjectType ?? null,
    subjectNumber: typeof input.subjectNumber === 'number' ? input.subjectNumber : null,
    sha: typeof input.sha === 'string' ? input.sha.slice(0, 64) : null,
    extra,
  };
}

// Client → server frames. Only presence heartbeats and typing indicators are
// relayed; anything else is dropped so clients can never forge domain events.
type ClientFrameKind = 'presence.heartbeat' | 'typing.start' | 'typing.stop';

interface ClientFrame {
  kind: ClientFrameKind;
  channel: string;
  name: string | null;
}

const CLIENT_KINDS: ReadonlySet<string> = new Set(['presence.heartbeat', 'typing.start', 'typing.stop']);

function parseClientFrame(raw: string | ArrayBuffer): ClientFrame | null {
  if ((typeof raw !== 'string') || raw.length === 0 || raw.length > MAX_MESSAGE_BYTES) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const frame = parsed as Record<string, unknown>;
  if (typeof frame.kind !== 'string' || !CLIENT_KINDS.has(frame.kind) || !isChannel(frame.channel)) return null;
  const name = typeof frame.name === 'string' ? frame.name.slice(0, 80) : null;
  return { kind: frame.kind as ClientFrameKind, channel: frame.channel, name };
}

export {
  REALTIME_VERSION,
  INBOX_SHARD,
  MAX_CHANNEL_LENGTH,
  MAX_EVENT_TYPE_LENGTH,
  MAX_TITLE_LENGTH,
  MAX_MESSAGE_BYTES,
  MAX_CHANNELS_PER_SOCKET,
  MAX_CLIENT_FRAMES_PER_MINUTE,
  PRESENCE_TTL_SECONDS,
  TICKET_ID_RE,
  repoShardFor,
  isRepoShard,
  isShard,
  isChannel,
  isInboxHash,
  inboxTagForHash,
  normalizeChannels,
  isEnvelope,
  buildEnvelope,
  parseClientFrame,
};
export type { RealtimeEnvelope, BuildEnvelopeInput, ClientFrame, ClientFrameKind };
