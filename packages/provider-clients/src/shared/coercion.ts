/**
Small structural coercions shared by the upstream adapters and Command Code
wire code. Centralised so a behaviour change (e.g. treating arrays as empty
records) happens once instead of in four near-identical copies.
*/

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asText(value: unknown): string {
  if (typeof value === 'string') return value;
  return value === null || value === undefined ? '' : JSON.stringify(value);
}

export { asArray, asRecord, asString, asText, isRecord };
