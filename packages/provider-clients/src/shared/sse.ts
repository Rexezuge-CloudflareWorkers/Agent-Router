/**
SSE helpers for relay/tap code that must scan `data:` lines out of a byte
stream or an already-buffered body.

Callers differ in what they do with each payload (track usage, rebuild a
response, feed a translator), so this only handles the framing: split a text
buffer into complete `data:` payloads, ignoring comments, blanks, and the
`[DONE]` sentinel.
*/

const DATA_PREFIX = 'data:';

/** Extracts the payload from a single SSE line, or null when the line is not
data (comments, event names, blank lines, or). */
function sseDataPayload(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith(DATA_PREFIX)) return null;
  const payload = trimmed.slice(DATA_PREFIX.length).trim();
  if (!payload || payload === '[DONE]') return null;
  return payload;
}

/**
Splits a buffered body into parsed JSON payloads from its `data:` lines.
Non-JSON payloads are skipped, matching the tolerance of the original
hand-rolled scanners.
*/
function parseSseJsonLines(text: string): unknown[] {
  const out: unknown[] = [];
  for (const line of text.split('\n')) {
    const payload = sseDataPayload(line);
    if (!payload) continue;
    try {
      out.push(JSON.parse(payload));
    } catch {
      // Non-JSON SSE frames (heartbeats, comments) carry no structured data.
    }
  }
  return out;
}

export { parseSseJsonLines, sseDataPayload };
