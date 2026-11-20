import { useTranslation } from 'react-i18next';
import type { CurrentUser } from '../types';
import { LanguageSettingsCard } from '../components/settings/LanguageSettingsCard';
import { ProfileSettingsCard } from '../components/settings/ProfileSettingsCard';
import { AppPage, PageHeader } from '../components/layout/AppPage';

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
    <AppPage>
      <PageHeader
        eyebrow={t('settings.eyebrow', 'Account')}
        title={t('settings.userSettings', 'User Settings')}
        description={t('settings.description', 'Manage your display name and interface language.')}
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <ProfileSettingsCard user={user} setUser={setUser} showNotice={showNotice} />
        <LanguageSettingsCard language={language} onLanguageChange={onLanguageChange} disabled={languageDisabled} />
      </div>
    </AppPage>
  );
}
