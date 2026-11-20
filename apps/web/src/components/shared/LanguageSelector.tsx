import { useTranslation } from 'react-i18next';
import { Globe } from 'lucide-react';
import { SUPPORTED_LANGUAGES, normalizeLanguage } from '../../i18n';
import { cn } from '../../lib/utils';

const NATIVE_NAMES: Record<string, string> = {
  en: 'English',
  de: 'Deutsch',
  fr: 'Français',
  es: 'Español',
  it: 'Italiano',
  nl: 'Nederlands',
  pt: 'Português',
  pl: 'Polski',
  ja: '日本語',
  'zh-CN': '简体中文',
  'zh-TW': '繁體中文',
  ko: '한국어',
};

export function LanguageSelector({
  value,
  onChange,
  disabled,
  compact,
  className,
}: {
  value?: string;
  onChange: (lng: string) => void;
  disabled?: boolean;
  compact?: boolean;
  className?: string;
}) {
  const { t, i18n } = useTranslation();
  const unknownLabel = t('settings.unknownLanguage', 'Unknown');
  const isUnknown = value === 'unknown';
  const current = isUnknown ? 'unknown' : normalizeLanguage(value ?? i18n.resolvedLanguage ?? i18n.language);
  const selectClass = cn(
    'rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] text-[var(--color-text-primary)] text-sm',
    'transition-colors focus:outline-none focus:border-[var(--color-accent)]',
    compact ? 'w-full px-2 py-1.5 text-xs' : 'px-2.5 py-1.5',
  );

  return (
    <label className={cn('flex items-center gap-2 text-sm text-[var(--color-text-muted)]', compact && 'w-full min-w-0', className)}>
      {compact ? (
        <Globe className="h-4 w-4 shrink-0" aria-hidden="true" />
      ) : (
        <span className="sr-only">{t('settings.selectLanguage', 'Select Language')}</span>
      )}
      <select
        aria-label={t('settings.selectLanguage', 'Select Language')}
        value={current}
        disabled={disabled || isUnknown}
        onChange={(e) => onChange(e.target.value)}
        className={selectClass}
      >
        {isUnknown ? (
          <option value="unknown">{unknownLabel}</option>
        ) : (
          SUPPORTED_LANGUAGES.map((lng) => (
            <option key={lng} value={lng}>
              {NATIVE_NAMES[lng] ?? lng}
            </option>
          ))
        )}
      </select>
    </label>
  );
}
