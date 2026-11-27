import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { GatewayKey, PeakPreference, PeakPreferenceMode, PeakPreferenceStatus } from '../../types';
import { loadGatewayKeyPeakStatus, saveGatewayKeyPeakPreference } from '../../services/gatewayKeyService';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Field, Input } from '../ui/Input';
import { cn } from '../../lib/utils';
import { ModalHeader, ModalShell } from './ModalShell';

const MODES: PeakPreferenceMode[] = ['continue', 'fallback', 'reject'];

export function GatewayKeyPeakSettingsDialog({
  gatewayKey,
  showNotice,
  onClose,
}: {
  gatewayKey: GatewayKey;
  showNotice: (type: 'success' | 'error', text: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<PeakPreferenceStatus | null>(null);
  const [mode, setMode] = useState<PeakPreferenceMode>('continue');
  const [fallbackModel, setFallbackModel] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadGatewayKeyPeakStatus(gatewayKey.keyId)
      .then((loaded) => {
        if (cancelled) return;
        setStatus(loaded);
        setMode(loaded.mode);
        setFallbackModel(loaded.fallbackModel ?? '');
      })
      .catch(() => {
        if (cancelled) return;
        showNotice('error', t('keys.peakLoadFailed', 'Unable to load peak-hours settings.'));
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once per key on mount
  }, [gatewayKey.keyId]);

  const trimmedFallback = fallbackModel.trim();
  const requiresFallback = mode === 'fallback';
  const canSave = !saving && !!status && (!requiresFallback || trimmedFallback.length > 0);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSave) return;
    setSaving(true);
    try {
      const input: PeakPreference = { mode, fallbackModel: requiresFallback ? trimmedFallback : null };
      const updated = await saveGatewayKeyPeakPreference(gatewayKey.keyId, input);
      setStatus((current) => (current ? { ...current, ...updated } : current));
      setMode(updated.mode);
      setFallbackModel(updated.fallbackModel ?? '');
      showNotice('success', t('keys.peakSaved', 'Peak-hours routing saved for this key.'));
      onClose();
    } catch (error) {
      showNotice('error', error instanceof Error ? error.message : t('keys.peakSaveFailed', 'Failed to save peak-hours routing.'));
    } finally {
      setSaving(false);
    }
  };

  const modeLabel: Record<PeakPreferenceMode, string> = {
    continue: t('keys.peakModeContinue', 'Continue Using The Model'),
    fallback: t('keys.peakModeFallback', 'Route To Another Model'),
    reject: t('keys.peakModeReject', 'Reject The Request'),
  };

  return (
    <ModalShell onClose={onClose} widthClass="w-[calc(100vw-2rem)] max-w-md" ariaLabel={t('keys.peakTitle', 'Peak Hours')}>
      <ModalHeader
        title={t('keys.peakTitle', 'Peak Hours')}
        onClose={onClose}
        actions={
          status && (
            <Badge variant={status.isPeak ? 'warning' : 'success'} dot>
              {status.isPeak ? t('keys.peakStatusNow', 'Peak Now') : t('keys.peakStatusOff', 'Off-Peak')}
            </Badge>
          )
        }
      />
      <form onSubmit={submit} className="space-y-4 p-5">
        <p className="text-xs text-[var(--color-text-muted)]">
          {t('keys.peakDescription', 'Choose what happens when this key calls a model in its peak window.')}
        </p>
        <p className="text-xs text-[var(--color-text-muted)]">
          {t('keys.peakSchedule', 'DeepSeek · Mon–Fri · 09:00–12:00, 14:00–18:00 (UTC+8)')}
        </p>
        <fieldset className="space-y-2" disabled={!status}>
          <legend className="sr-only">{t('keys.peakTitle', 'Peak Hours')}</legend>
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
            label={t('keys.peakFallbackModel', 'Fallback Model')}
            htmlFor="peak-fallback-model"
            hint={t('keys.peakFallbackHint', 'Any model id the gateway can serve, e.g. moonshotai/Kimi-K2.5.')}
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
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            {t('common.cancel', 'Cancel')}
          </Button>
          <Button type="submit" variant="primary" size="sm" loading={saving} disabled={!canSave}>
            {t('common.saveChanges', 'Save Changes')}
          </Button>
        </div>
      </form>
    </ModalShell>
  );
}
