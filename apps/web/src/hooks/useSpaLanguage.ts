import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LANGUAGE_STORAGE_KEY, detectInitialLanguage, loadLanguage, normalizeLanguage } from '../i18n';
import type { CurrentUser } from '../types';

interface UseSpaLanguageInput {
  user: CurrentUser | null;
  showNotice: (type: 'success' | 'error', text: string) => void;
  setUser: (user: CurrentUser) => void;
}

/**
 * Language state slice extracted from `SpaApp` so the shell stays thin.
 * Owns detection precedence (backend `preferredLanguage` when present >
 * localStorage > navigator > en), `<html lang>` sync, and the manual-change
 * flow. Backend persistence is best-effort: the current API does not store
 * `preferredLanguage` yet, so failures fall back to local-only persistence.
 */
function useSpaLanguage({ user, showNotice, setUser }: UseSpaLanguageInput) {
  const [language, setLanguage] = useState<string>(() => detectInitialLanguage());
  const [languageStatus, setLanguageStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [languagePending, setLanguagePending] = useState(false);
  const languagePendingRef = useRef(false);
  const { t, i18n } = useTranslation();

  // Keep explicit language state in sync with i18next so the controlled
  // LanguageSelector re-renders even when only the i18n instance changes.
  useEffect(() => {
    const handler = (lng: string) => {
      setLanguage(normalizeLanguage(lng));
      setLanguageStatus('ready');
    };
    i18n.on('languageChanged', handler);
    return () => {
      i18n.off('languageChanged', handler);
    };
  }, [i18n]);

  useEffect(() => {
    if (!user || languagePendingRef.current) return;
    const preferred = normalizeLanguage(
      user.preferredLanguage ??
        (() => {
          try {
            return localStorage.getItem(LANGUAGE_STORAGE_KEY);
          } catch {
            return null;
          }
        })(),
    );
    // Already on this language with its bundle loaded: reloading would still
    // call changeLanguage, mint a new `t` identity, and refire every data
    // effect that (correctly) lists `t` in deps — skip it.
    if (normalizeLanguage(i18n.language) === preferred && i18n.hasResourceBundle(preferred, 'translation')) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing already-correct external i18n state into React on user load; values are identical so this settles instead of looping.
      setLanguage(preferred);
      setLanguageStatus('ready');
      return;
    }
    let cancelled = false;
    setLanguageStatus('loading');
    loadLanguage(preferred)
      .then(() => {
        if (cancelled) return;
        setLanguage(preferred);
        setLanguageStatus('ready');
        try {
          document.documentElement.lang = preferred;
        } catch {
          // Ignore DOM errors in non-browser environments.
        }
      })
      .catch(() => {
        if (cancelled) return;
        setLanguage('unknown');
        setLanguageStatus('error');
        showNotice('error', t('errors.languageLoadFailed', 'Unable To Load Language.'));
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: user-only trigger + ref guard
  }, [user]);

  useEffect(() => {
    if (languageStatus === 'error') return;
    try {
      document.documentElement.lang = normalizeLanguage(language);
    } catch {
      // Ignore DOM errors in non-browser environments.
    }
  }, [language, languageStatus]);

  const handleLanguageChange = (lng: string) => {
    if (languagePending || languagePendingRef.current) return;
    const normalized = normalizeLanguage(lng);
    languagePendingRef.current = true;
    setLanguagePending(true);
    setLanguageStatus('loading');
    void (async () => {
      try {
        await loadLanguage(normalized);
        try {
          localStorage.setItem(LANGUAGE_STORAGE_KEY, normalized);
        } catch {
          // Ignore storage errors.
        }
        if (user) setUser({ ...user, preferredLanguage: normalized });
        setLanguage(normalized);
        setLanguageStatus('ready');
      } catch {
        setLanguage('unknown');
        setLanguageStatus('error');
        showNotice('error', t('errors.languageSaveFailed', 'Unable To Save Language.'));
      } finally {
        languagePendingRef.current = false;
        setLanguagePending(false);
      }
    })();
  };

  return { language, languageStatus, languagePending, handleLanguageChange };
}

export { useSpaLanguage };
