import { useTranslation } from 'react-i18next';
import { UserRound } from 'lucide-react';
import type { CurrentUser } from '../types';
import { LanguageSettingsCard } from '../components/settings/LanguageSettingsCard';
import { ProfileSettingsCard } from '../components/settings/ProfileSettingsCard';
import { AppPage, PageHeaderCard } from '@rexezuge/web';
import { ContextBar } from '../components/layout/ContextBar';

export function SettingsView({
  user,
  setUser,
  showNotice,
  language,
  onLanguageChange,
  languageDisabled,
}: {
  user: CurrentUser;
  setUser: (user: CurrentUser) => void;
  showNotice: (type: 'success' | 'error', text: string) => void;
  language: string;
  onLanguageChange: (lng: string) => void;
  languageDisabled?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div>
      <ContextBar
        crumb={
          <span className="text-xl font-semibold text-[var(--color-text-primary)] truncate">
            {t('settings.userSettings', 'User Settings')}
          </span>
        }
      />
      <AppPage>
        <PageHeaderCard
          icon={<UserRound className="h-5 w-5 text-[var(--color-text-secondary)]" />}
          title={t('settings.userSettings', 'User Settings')}
          description={user.email}
        />

        <ProfileSettingsCard user={user} setUser={setUser} showNotice={showNotice} />

        <LanguageSettingsCard language={language} onLanguageChange={onLanguageChange} disabled={languageDisabled} />
      </AppPage>
    </div>
  );
}
