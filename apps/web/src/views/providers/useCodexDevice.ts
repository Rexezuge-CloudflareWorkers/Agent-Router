import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getCodexDeviceStatus, startCodexDevice, type CodexDeviceStart } from '../../services/providerService';

export interface CodexDeviceSession {
  providerId: string;
  keyId: string;
  flow: CodexDeviceStart;
}

export function useCodexDevice({ onConnected, onError }: { onConnected: () => void; onError: (message: string) => void }) {
  const { t } = useTranslation();
  const [session, setSession] = useState<CodexDeviceSession | null>(null);
  const [starting, setStarting] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sessionRef = useRef<CodexDeviceSession | null>(null);
  const scheduleRef = useRef<(next: CodexDeviceSession) => void>(() => {});

  const clearTimer = useCallback(() => {
    if (timerRef.current === null) {
      return;
    }

    clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  const cancel = useCallback(() => {
    clearTimer();
    sessionRef.current = null;
    setSession(null);
  }, [clearTimer]);

  const poll = useCallback(async () => {
    const current = sessionRef.current;
    if (!current) return;
    try {
      const status = await getCodexDeviceStatus(current.providerId, current.keyId);
      if (status.status === 'connected') {
        cancel();
        onConnected();
        return;
      }
      if (status.status === 'expired') {
        cancel();
        onError(t('providers.codexDeviceExpired', 'Codex authorization expired. Start again and approve faster.'));
        return;
      }
      if (status.status === 'failed') {
        cancel();
        onError(status.message || t('providers.codexAuthFailed', 'Codex authorization failed.'));
        return;
      }
      scheduleRef.current({
        ...current,
        flow: { ...current.flow, expiresAt: status.expiresAt, pollIntervalSeconds: status.pollIntervalSeconds },
      });
    } catch {
      // Transient failure: keep polling while the code is still valid.
      scheduleRef.current(current);
    }
  }, [cancel, onConnected, onError, t]);

  const schedule = useCallback(
    (next: CodexDeviceSession) => {
      clearTimer();
      sessionRef.current = next;
      setSession(next);
      const delay = Math.max(1000, next.flow.pollIntervalSeconds * 1000);
      timerRef.current = setTimeout(() => void poll(), delay);
    },
    [clearTimer, poll],
  );

  useEffect(() => {
    scheduleRef.current = schedule;
  }, [schedule]);

  const start = useCallback(
    async (providerId: string, keyId: string) => {
      setStarting(true);
      try {
        const flow = await startCodexDevice(providerId, keyId);
        open(flow.verificationUrl, '_blank', 'noopener');
        schedule({ providerId, keyId, flow });
      } catch (error) {
        onError(error instanceof Error ? error.message : t('providers.codexStartFailed', 'Failed to start Codex authorization.'));
      } finally {
        setStarting(false);
      }
    },
    [onError, schedule, t],
  );

  useEffect(() => () => clearTimer(), [clearTimer]);

  return { session, starting, start, cancel };
}
