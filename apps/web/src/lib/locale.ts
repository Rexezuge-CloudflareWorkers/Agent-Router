import { LANGUAGE_STORAGE_KEY, SUPPORTED_LANGUAGES, canonicalizeLanguageTag, normalizeLanguage } from '../i18n';

/**
Canonicalize a BCP 47-ish language tag (`en_us` → `en-US`,
`ZH-cn` → `zh-CN`) so locale matching is case- and separator-insensitive.
Delegates to the single `i18n` canonicalizer (no duplicated logic).
*/
export function canonicalizeLocaleTag(tag: string): string {
  return canonicalizeLanguageTag(tag);
}

/**
Normalize an arbitrary language tag to one of the supported language tags.
Unknown tags fall back to `en` (`zh` base → `zh-CN`, bare base → matching
supported tag when one exists).
*/
export function normalizeLocale(tag: string | null | undefined): string {
  if (!tag || typeof tag !== 'string') return 'en';
  const canonical = canonicalizeLocaleTag(tag);
  return (SUPPORTED_LANGUAGES as readonly string[]).includes(canonical) ? canonical : normalizeLanguage(canonical);
}

/**
Resolve the active locale: explicit `lng` first, then the stored SPA
language, then the browser language, defaulting to `en`.
*/
export function resolveLocale(lng?: string | null): string {
  if (lng) return normalizeLocale(lng);
  try {
    const stored = typeof localStorage === 'undefined' ? null : localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (stored) return normalizeLocale(stored);
  } catch {
    // Ignore storage errors.
  }
  try {
    if (typeof navigator !== 'undefined' && navigator.language) return normalizeLocale(navigator.language);
  } catch {
    // Ignore and fall through.
  }
  return 'en';
}

export interface LocaleDateOptions extends Intl.DateTimeFormatOptions {
  lng?: string | null;
}

export function formatDateLocale(date: Date, options: LocaleDateOptions = {}): string {
  const { lng, ...intlOptions } = options;
  return date.toLocaleDateString(resolveLocale(lng), intlOptions);
}

export interface LocaleTimeOptions extends Intl.DateTimeFormatOptions {
  lng?: string | null;
}

export function formatTimeLocale(date: Date, options: LocaleTimeOptions = {}): string {
  const { lng, ...intlOptions } = options;
  return date.toLocaleTimeString(resolveLocale(lng), intlOptions);
}

export interface LocaleNumberFormatOptions extends Intl.NumberFormatOptions {
  lng?: string | null;
}

export function formatNumberLocale(value: number, options: LocaleNumberFormatOptions = {}): string {
  const { lng, ...intlOptions } = options;
  const tag = resolveLocale(lng);
  return value.toLocaleString(tag, intlOptions);
}
