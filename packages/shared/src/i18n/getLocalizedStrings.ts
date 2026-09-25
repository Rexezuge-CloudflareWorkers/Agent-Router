import type { BackendLocaleStrings, SupportedBackendLocale } from './BackendStrings';
import { normalizeBackendLocale } from './BackendStrings';
import { enStrings } from './locales/en';
import { zhCNStrings } from './locales/zh-CN';

const BACKEND_STRINGS: Record<SupportedBackendLocale, BackendLocaleStrings> = {
  en: enStrings,
  'zh-CN': zhCNStrings,
};

function getBackendStrings(locale: string | null | undefined): BackendLocaleStrings {
  return BACKEND_STRINGS[normalizeBackendLocale(locale)];
}

function resolveLocalizedStrings(locale?: string | null, fallback?: string | null): BackendLocaleStrings {
  const primary = normalizeBackendLocale(locale);
  return getBackendStrings(primary === 'en' ? normalizeBackendLocale(fallback) : primary);
}

export { BACKEND_STRINGS, getBackendStrings, resolveLocalizedStrings };
