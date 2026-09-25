import { resolveLocale } from './locale';

export function formatTimestamp(timestampSeconds: number | null | undefined, lng?: string | null): string {
  if (timestampSeconds === null || timestampSeconds === undefined) return 'Never';
  const date = new Date(timestampSeconds * 1000);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60_000);
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return diffDays < 7 ? `${diffDays}d ago` : date.toLocaleDateString(resolveLocale(lng));
}

export function formatExpiryTimestamp(timestampSeconds: number | null | undefined, lng?: string | null): string {
  if (timestampSeconds === null || timestampSeconds === undefined) return 'Never';
  const date = new Date(timestampSeconds * 1000);
  const now = new Date();
  const diffMs = date.getTime() - now.getTime();
  const diffMins = Math.floor(diffMs / 60_000);
  if (diffMins < 1) return 'Expires soon';
  if (diffMins < 60) return `Expires in ${diffMins}m`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `Expires in ${diffHours}h`;
  const diffDays = Math.floor(diffHours / 24);
  return diffDays < 30 ? `Expires in ${diffDays}d` : `Expires ${date.toLocaleDateString(resolveLocale(lng))}`;
}

export function formatCommitDate(timestampSeconds: number, timezoneOffset: number, lng?: string | null): string {
  const date = new Date((timestampSeconds + timezoneOffset * 60) * 1000);
  return date.toLocaleDateString(resolveLocale(lng), { month: 'short', day: 'numeric', year: 'numeric' });
}

export function firstLine(message: string): string {
  return message.split('\n', 1)[0] ?? message;
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
}
