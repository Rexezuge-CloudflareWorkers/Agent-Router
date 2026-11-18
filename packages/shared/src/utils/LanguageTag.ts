/**
Single canonical language-tag implementation for backend + web.
Previously duplicated as `canonicalizeBackendLocaleTag` (shared) and
`canonicalizeTag` (web `i18n.ts`). Import from here in both layers.
*/
function canonicalizeLanguageTag(tag: string): string {
  const normalized = tag.trim().replaceAll('_', '-');
  const parts = normalized.split('-').filter(Boolean);
  if (parts.length === 0) return 'en';
  const language = (parts[0] ?? 'en').toLowerCase();
  if (parts.length === 1) return language;
  const rest = parts.slice(1).map((part) => (part.length === 2 ? part.toUpperCase() : part.toLowerCase()));
  return [language, ...rest].join('-');
}

export { canonicalizeLanguageTag };
