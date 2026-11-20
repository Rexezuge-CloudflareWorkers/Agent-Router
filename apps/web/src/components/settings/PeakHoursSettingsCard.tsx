import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { PeakPreference, PeakPreferenceMode, PeakPreferenceStatus } from '../../types';
import { loadPeakPreference, savePeakPreference } from '../../services/peakPreferenceService';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Card, CardDescription, CardHeader, CardTitle } from '../ui/Card';
import { Field, Input } from '../ui/Input';
import { cn } from '../../lib/utils';

const MODES: PeakPreferenceMode[] = ['continue', 'fallback', 'reject'];

export function PeakHoursSettingsCard({ showNotice }: { showNotice: (type: 'success' | 'error', text: string) => void }) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<PeakPreferenceStatus | null>(null);
  const [mode, setMode] = useState<PeakPreferenceMode>('continue');
  const [fallbackModel, setFallbackModel] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadPeakPreference()
      .then((loaded) => {
        if (cancelled) return;
        setStatus(loaded);
        setMode(loaded.mode);
        setFallbackModel(loaded.fallbackModel ?? '');
      })
      .catch(() => {
        if (cancelled) return;
        showNotice('error', t('settings.peakLoadFailed', 'Unable to load peak-hours settings.'));
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once on mount
  }, []);

  const trimmedFallback = fallbackModel.trim();
  const requiresFallback = mode === 'fallback';
  const canSave = !saving && (!requiresFallback || trimmedFallback.length > 0);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSave) return;
    setSaving(true);
    try {
      const input: PeakPreference = { mode, fallbackModel: requiresFallback ? trimmedFallback : null };
      const updated = await savePeakPreference(input);
      setStatus((current) => (current ? { ...current, ...updated } : current));
      setMode(updated.mode);
      setFallbackModel(updated.fallbackModel ?? '');
      showNotice('success', t('settings.peakSaved', 'Peak-hours preference saved.'));
    } catch (error) {
      showNotice('error', error instanceof Error ? error.message : t('settings.peakSaveFailed', 'Failed to save peak-hours preference.'));
    } finally {
      setSaving(false);
    }
  };

  const modeLabel: Record<PeakPreferenceMode, string> = {
    continue: t('settings.peakModeContinue', 'Continue Using The Model'),
    fallback: t('settings.peakModeFallback', 'Route To Another Model'),
    reject: t('settings.peakModeReject', 'Reject The Request'),
  };

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>{t('settings.peakTitle', 'Peak Hours')}</CardTitle>
          <CardDescription>{t('settings.peakDescription', 'Choose what happens when a model is in its peak window.')}</CardDescription>
        </div>
        {status && (
          <Badge variant={status.isPeak ? 'warning' : 'success'} dot>
            {status.isPeak ? t('settings.peakStatusNow', 'Peak Now') : t('settings.peakStatusOff', 'Off-Peak')}
          </Badge>
        )}
      </CardHeader>

      <p className="mb-4 text-xs text-[var(--color-text-muted)]">
        {t('settings.peakSchedule', 'DeepSeek · Mon–Fri · 09:00–12:00, 14:00–18:00 (UTC+8)')}
      </p>

      <form onSubmit={submit} className="space-y-4">
        <fieldset className="space-y-2" disabled={!status}>
          <legend className="sr-only">{t('settings.peakTitle', 'Peak Hours')}</legend>
          {MODES.map((option) => (
            <label
              key={option}
              className={cn(
                'flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 text-sm transition-colors',
                mode === option
                  ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/8 text-[var(--color-text-primary)]'
                  : 'border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-[var(--color-border-muted)]',
              )}
            >
              <input
                type="radio"
                name="peak-mode"
                value={option}
                checked={mode === option}
                onChange={() => setMode(option)}
                className="accent-[var(--color-accent)]"
              />
              {modeLabel[option]}
            </label>
          ))}
        </fieldset>

        {requiresFallback && (
          <Field
            label={t('settings.peakFallbackModel', 'Fallback Model')}
            htmlFor="peak-fallback-model"
            hint={t('settings.peakFallbackHint', 'Any model id the gateway can serve, e.g. moonshotai/Kimi-K2.5.')}
          >
            <Input
              id="peak-fallback-model"
              placeholder="moonshotai/Kimi-K2.5"
              value={fallbackModel}
              maxLength={200}
              onChange={(e) => setFallbackModel(e.target.value)}
            />
          </Field>
        )}

        <Button type="submit" variant="primary" size="sm" loading={saving} disabled={!canSave || !status}>
          {t('common.saveChanges', 'Save Changes')}
        </Button>
      </form>
    </Card>
  );
}
